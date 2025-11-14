import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { lookup } from 'mime-types';
import type { S3Config } from '../types/index.js';
import { UploadStatus } from '../types/index.js';
import type { S3UploadTask } from '../models/S3UploadTask.js';
import { createS3UploadTask } from '../models/S3UploadTask.js';
import { getLogger, createChildLogger } from '../lib/logger.js';
import { randomUUID } from 'crypto';

export class S3Uploader {
  private client: S3Client;
  private config: S3Config;
  private logger = getLogger();

  constructor(config: S3Config) {
    this.config = config;

    // Initialize S3 client
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });

    this.logger.info({ endpoint: config.endpoint, region: config.region, bucket: config.bucket }, 'S3Uploader initialized');
  }

  /**
   * Upload a file to S3 with streaming multipart support
   * @param filePath Local file path
   * @param s3Key S3 object key
   * @param size File size
   * @param maxRetries Maximum retry attempts
   * @returns Upload task with result
   */
  async uploadFile(
    filePath: string,
    s3Key: string,
    size: number,
    maxRetries: number = 3
  ): Promise<S3UploadTask> {
    const taskId = randomUUID();
    const contentType = this.detectContentType(filePath);
    const task = createS3UploadTask(taskId, filePath, s3Key, this.config.bucket, contentType, size);

    const logger = createChildLogger({ taskId, s3Key, filePath });
    logger.info({ size, contentType }, 'Starting S3 upload');

    task.status = UploadStatus.UPLOADING;

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        // Create file stream
        const stream = createReadStream(filePath);

        // Upload with multipart support
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: this.config.bucket,
            Key: s3Key,
            Body: stream,
            ContentType: contentType,
            Metadata: {
              'upload-id': taskId,
              'source-path': filePath,
              'x-completed': 'true', // Completion marker
            },
          },
        });

        // Track progress
        upload.on('httpUploadProgress', (progress) => {
          if (progress.loaded) {
            task.uploadedBytes = progress.loaded;
            logger.debug({ uploaded: progress.loaded, total: progress.total }, 'Upload progress');
          }
        });

        const result = await upload.done();

        // Verify upload
        task.etag = result.ETag ?? null;
        task.status = UploadStatus.VERIFYING;

        const isValid = await this.verifyUpload(s3Key, task.etag);
        if (!isValid) {
          throw new Error('Upload verification failed: ETag mismatch');
        }

        task.status = UploadStatus.COMPLETED;
        logger.info({ etag: task.etag, size: task.uploadedBytes }, 'Upload completed successfully');

        return task;

      } catch (error) {
        attempt++;
        const err = error as Error;
        logger.warn({ error: err, attempt, maxRetries }, 'Upload attempt failed');

        if (attempt > maxRetries) {
          task.status = UploadStatus.FAILED;
          task.error = err;
          logger.error({ error: err }, 'Upload failed after max retries');
          throw err;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        logger.info({ delay }, 'Retrying upload after delay');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Upload failed');
  }

  /**
   * Upload a stream to S3
   * @param stream Readable stream
   * @param s3Key S3 object key
   * @param contentType MIME type
   * @returns Upload task
   */
  async uploadStream(
    stream: Readable,
    s3Key: string,
    contentType: string,
    sourceId: string = 'stream'
  ): Promise<S3UploadTask> {
    const taskId = randomUUID();
    const task = createS3UploadTask(taskId, sourceId, s3Key, this.config.bucket, contentType, null);

    const logger = createChildLogger({ taskId, s3Key, sourceId });
    logger.info({ contentType }, 'Starting S3 stream upload');

    task.status = UploadStatus.UPLOADING;

    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucket,
          Key: s3Key,
          Body: stream,
          ContentType: contentType,
          Metadata: {
            'upload-id': taskId,
            'x-completed': 'true',
          },
        },
      });

      upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded) {
          task.uploadedBytes = progress.loaded;
        }
      });

      const result = await upload.done();

      task.etag = result.ETag ?? null;
      task.status = UploadStatus.COMPLETED;
      logger.info({ etag: task.etag, size: task.uploadedBytes }, 'Stream upload completed');

      return task;

    } catch (error) {
      const err = error as Error;
      task.status = UploadStatus.FAILED;
      task.error = err;
      logger.error({ error: err }, 'Stream upload failed');
      throw err;
    }
  }

  /**
   * Verify upload integrity by checking object exists with correct ETag
   * @param s3Key S3 object key
   * @param expectedETag Expected ETag
   * @returns True if verification passed
   */
  async verifyUpload(s3Key: string, expectedETag: string | null): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: s3Key,
      });

      const response = await this.client.send(command);

      // Check completion marker
      const isComplete = response.Metadata?.['x-completed'] === 'true';

      if (!isComplete) {
        this.logger.warn({ s3Key }, 'Upload missing completion marker');
        return false;
      }

      // Verify ETag if provided
      if (expectedETag && response.ETag !== expectedETag) {
        this.logger.warn({ s3Key, expected: expectedETag, actual: response.ETag }, 'ETag mismatch');
        return false;
      }

      return true;

    } catch (error) {
      this.logger.error({ s3Key, error }, 'Upload verification failed');
      return false;
    }
  }

  /**
   * Detect incomplete uploads (missing completion marker) and delete them
   * @param s3Key S3 object key
   * @returns True if incomplete upload was cleaned up
   */
  async cleanupIncompleteUpload(s3Key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: s3Key,
      });

      const response = await this.client.send(command);
      const isComplete = response.Metadata?.['x-completed'] === 'true';

      if (!isComplete) {
        this.logger.info({ s3Key }, 'Deleting incomplete upload');

        const deleteCommand = new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: s3Key,
        });

        await this.client.send(deleteCommand);
        return true;
      }

      return false;

    } catch (error) {
      // Object doesn't exist, nothing to clean up
      return false;
    }
  }

  /**
   * Detect content type from file path
   * @param filePath File path
   * @returns MIME type
   */
  private detectContentType(filePath: string): string {
    const mimeType = lookup(filePath);

    // Special handling for Parquet files
    if (filePath.endsWith('.parquet')) {
      return 'application/vnd.apache.parquet';
    }

    return mimeType || 'application/octet-stream';
  }

  /**
   * Get S3 client for direct access
   */
  getClient(): S3Client {
    return this.client;
  }
}
