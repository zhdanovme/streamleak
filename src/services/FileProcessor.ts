import { mkdir, rename } from 'fs/promises';
import { join, basename } from 'path';
import type { AppConfig } from '../types/index.js';
import { ProcessingStatus, ProcessingStep, FileType } from '../types/index.js';
import type { FileMetadata } from '../models/FileMetadata.js';
import {
  createProcessingJob,
  markStepStarted,
  markStepComplete,
  markJobComplete,
  markJobFailed,
  type ProcessingJob,
} from '../models/ProcessingJob.js';
import { S3Uploader } from './S3Uploader.js';
import { ProgressTracker } from './ProgressTracker.js';
import { ParquetConverter } from './ParquetConverter.js';
import { ArchiveExtractor } from './ArchiveExtractor.js';
import { calculateFileChecksum } from '../lib/checksum.js';
import { getLogger, createChildLogger } from '../lib/logger.js';

export class FileProcessor {
  private config: AppConfig;
  private s3Uploader: S3Uploader;
  private progressTracker: ProgressTracker | null;
  private parquetConverter: ParquetConverter | null;
  private archiveExtractor: ArchiveExtractor | null;
  private logger = getLogger();
  private activeJobs: Map<string, ProcessingJob> = new Map();

  constructor(
    config: AppConfig,
    s3Uploader: S3Uploader,
    progressTracker?: ProgressTracker,
    parquetConverter?: ParquetConverter,
    archiveExtractor?: ArchiveExtractor
  ) {
    this.config = config;
    this.s3Uploader = s3Uploader;
    this.progressTracker = progressTracker ?? null;
    this.parquetConverter = parquetConverter ?? null;
    this.archiveExtractor = archiveExtractor ?? null;
  }

  /**
   * Process a detected file
   * @param file File metadata
   */
  async processFile(file: FileMetadata): Promise<void> {
    const job = createProcessingJob(file);
    this.activeJobs.set(job.id, job);

    const logger = createChildLogger({
      jobId: job.id,
      filePath: file.path,
      fileType: file.type,
    });

    try {
      logger.info({ size: file.size }, 'Starting file processing');

      // Step 1: Calculate checksum
      markStepStarted(job, ProcessingStep.CHECKSUM_CALCULATION);
      logger.debug('Calculating file checksum');
      file.checksum = await calculateFileChecksum(file.path);
      markStepComplete(job, ProcessingStep.CHECKSUM_CALCULATION);
      logger.debug({ checksum: file.checksum }, 'Checksum calculated');

      // Check if already processed
      if (this.progressTracker) {
        const existingRecord = this.progressTracker.checkIsProcessed(file.path);

        if (existingRecord) {
          if (existingRecord.status === ProcessingStatus.COMPLETED) {
            // Check if file was modified
            const wasModified = file.checksum &&
              this.progressTracker.detectModifiedFiles(file.path, file.checksum);

            if (!wasModified) {
              logger.info('File already processed, skipping');
              return;
            }

            logger.info('File was modified, reprocessing');
          } else if (existingRecord.status === ProcessingStatus.IN_PROGRESS) {
            logger.info('Found incomplete upload, resuming');
          }
        }

        // Record start
        this.progressTracker.recordStart(file.path, file.size, file.checksum);
        this.progressTracker.markInProgress(file.path);
      }

      job.status = ProcessingStatus.IN_PROGRESS;

      // Step 2: Type detection (already done by FileMonitor)
      markStepStarted(job, ProcessingStep.TYPE_DETECTION);
      logger.debug({ type: file.type }, 'File type detected');
      markStepComplete(job, ProcessingStep.TYPE_DETECTION);

      // Step 3: Process based on file type
      switch (file.type) {
        case FileType.ARCHIVE:
          if (this.archiveExtractor) {
            await this.extractAndUploadArchive(job);
          } else {
            logger.warn('ArchiveExtractor not available, uploading archive as-is');
            await this.uploadRegularFile(job);
          }
          break;

        case FileType.DATABASE:
          if (this.parquetConverter) {
            await this.convertAndUploadDatabaseFile(job);
          } else {
            logger.warn('ParquetConverter not available, uploading database file as-is');
            await this.uploadRegularFile(job);
          }
          break;

        case FileType.REGULAR:
        default:
          await this.uploadRegularFile(job);
          break;
      }

      // Mark job complete
      markJobComplete(job);

      // Update progress tracker
      if (this.progressTracker) {
        this.progressTracker.markComplete(file.path, file.relativePath, file.size);
      }

      logger.info({ duration: Date.now() - job.startTime.getTime() }, 'File processing completed');

    } catch (error) {
      const err = error as Error;
      markJobFailed(job, err);
      logger.error({ error: err }, 'File processing failed');

      // Update progress tracker
      if (this.progressTracker) {
        this.progressTracker.markFailed(file.path, err.message);
      }

      // Move file to error directory
      await this.moveToErrorDirectory(file.path, err.message);

    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Upload a regular file directly to S3
   * @param job Processing job
   */
  private async uploadRegularFile(job: ProcessingJob): Promise<void> {
    const file = job.file;
    const logger = createChildLogger({ jobId: job.id, filePath: file.path });

    markStepStarted(job, ProcessingStep.S3_UPLOAD);
    logger.info({ s3Key: file.relativePath }, 'Uploading file to S3');

    const uploadTask = await this.s3Uploader.uploadFile(
      file.path,
      file.relativePath,
      file.size,
      this.config.processing.maxRetries
    );

    markStepComplete(job, ProcessingStep.S3_UPLOAD);
    logger.info({ s3Key: file.relativePath, etag: uploadTask.etag }, 'File uploaded to S3');

    // Integrity verification
    markStepStarted(job, ProcessingStep.INTEGRITY_VERIFICATION);
    const isValid = await this.s3Uploader.verifyUpload(file.relativePath, uploadTask.etag);

    if (!isValid) {
      throw new Error('Upload integrity verification failed');
    }

    markStepComplete(job, ProcessingStep.INTEGRITY_VERIFICATION);
    logger.info('Upload integrity verified');
  }

  /**
   * Convert database file to Parquet and upload to S3
   * @param job Processing job
   */
  private async convertAndUploadDatabaseFile(job: ProcessingJob): Promise<void> {
    const file = job.file;
    const logger = createChildLogger({ jobId: job.id, filePath: file.path });

    if (!this.parquetConverter) {
      throw new Error('ParquetConverter not initialized');
    }

    let tempFilePath: string | null = null;

    try {
      // Convert to Parquet
      markStepStarted(job, ProcessingStep.PARQUET_CONVERSION);
      logger.info({ extension: file.extension }, 'Converting database file to Parquet');

      const { stream, tempFilePath: tempFile, parquetFileName } =
        await this.parquetConverter.convertToParquetStream(file.path, file.extension);

      tempFilePath = tempFile;
      markStepComplete(job, ProcessingStep.PARQUET_CONVERSION);
      logger.info({ parquetFileName }, 'Converted to Parquet');

      // Get S3 key with .parquet extension
      const parquetS3Key = file.relativePath.replace(/\.[^.]+$/, '.parquet');

      // Upload Parquet stream to S3
      markStepStarted(job, ProcessingStep.S3_UPLOAD);
      logger.info({ s3Key: parquetS3Key }, 'Uploading Parquet file to S3');

      const uploadTask = await this.s3Uploader.uploadStream(
        stream,
        parquetS3Key,
        'application/vnd.apache.parquet',
        file.path
      );

      markStepComplete(job, ProcessingStep.S3_UPLOAD);
      logger.info({ s3Key: parquetS3Key, etag: uploadTask.etag }, 'Parquet file uploaded to S3');

      // Integrity verification
      markStepStarted(job, ProcessingStep.INTEGRITY_VERIFICATION);
      const isValid = await this.s3Uploader.verifyUpload(parquetS3Key, uploadTask.etag);

      if (!isValid) {
        throw new Error('Upload integrity verification failed');
      }

      markStepComplete(job, ProcessingStep.INTEGRITY_VERIFICATION);
      logger.info('Upload integrity verified');

      // Update file metadata for progress tracking (use Parquet S3 key)
      file.relativePath = parquetS3Key;

    } finally {
      // Clean up temporary Parquet file
      if (tempFilePath && this.parquetConverter) {
        await this.parquetConverter.cleanupTempFile(tempFilePath);
      }
    }
  }

  /**
   * Extract archive and upload contents to S3
   * @param job Processing job
   */
  private async extractAndUploadArchive(job: ProcessingJob): Promise<void> {
    const file = job.file;
    const logger = createChildLogger({ jobId: job.id, filePath: file.path });

    if (!this.archiveExtractor) {
      throw new Error('ArchiveExtractor not initialized');
    }

    markStepStarted(job, ProcessingStep.ARCHIVE_EXTRACTION);
    logger.info('Extracting archive');

    let entryCount = 0;

    try {
      for await (const entry of this.archiveExtractor.extractArchive(file.path)) {
        if (entry.isDirectory) {
          continue;
        }

        entryCount++;
        logger.debug({ path: entry.path }, 'Processing archive entry');

        // Get S3 key (preserve directory structure from archive)
        const baseDir = file.relativePath.replace(/\.[^.]+$/, ''); // Remove extension
        const entryS3Key = `${baseDir}/${entry.path}`;

        // Check if entry is a database file
        const entryType = this.getFileType(entry.path);

        if (entryType === FileType.DATABASE && this.parquetConverter) {
          // Database file in archive - needs Parquet conversion
          // For simplicity, we'll skip Parquet conversion for files inside archives
          // Full implementation would require writing entry to temp file first
          logger.warn({ path: entry.path }, 'Parquet conversion for archive entries not yet implemented, uploading as-is');

          await this.s3Uploader.uploadStream(
            entry.stream,
            entryS3Key,
            'application/octet-stream',
            entry.path
          );
        } else {
          // Regular file - upload directly
          const contentType = this.getContentType(entry.path);

          await this.s3Uploader.uploadStream(
            entry.stream,
            entryS3Key,
            contentType,
            entry.path
          );
        }

        logger.debug({ path: entry.path, s3Key: entryS3Key }, 'Archive entry uploaded');
      }

      markStepComplete(job, ProcessingStep.ARCHIVE_EXTRACTION);
      logger.info({ entryCount }, 'Archive extraction complete');

    } catch (error) {
      logger.error({ error }, 'Archive extraction failed');
      throw error;
    }
  }

  /**
   * Get file type from path
   * @param path File path
   * @returns File type
   */
  private getFileType(path: string): FileType {
    const lower = path.toLowerCase();

    if (lower.endsWith('.csv') || lower.endsWith('.json') || lower.endsWith('.xml') ||
        lower.endsWith('.jsonl') || lower.endsWith('.tsv')) {
      return FileType.DATABASE;
    }

    if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz') ||
        lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      return FileType.ARCHIVE;
    }

    return FileType.REGULAR;
  }

  /**
   * Get content type from file extension
   * @param path File path
   * @returns Content type
   */
  private getContentType(path: string): string {
    const lower = path.toLowerCase();

    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.csv')) return 'text/csv';
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.xml')) return 'application/xml';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.parquet')) return 'application/vnd.apache.parquet';

    return 'application/octet-stream';
  }

  /**
   * Move failed file to error directory
   * @param filePath File path
   * @param errorMessage Error message
   */
  private async moveToErrorDirectory(filePath: string, errorMessage: string): Promise<void> {
    try {
      // Ensure error directory exists
      await mkdir(this.config.processing.errorDirectory, { recursive: true });

      const fileName = basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const errorFileName = `${timestamp}_${fileName}`;
      const errorFilePath = join(this.config.processing.errorDirectory, errorFileName);

      await rename(filePath, errorFilePath);

      this.logger.info(
        { originalPath: filePath, errorPath: errorFilePath, error: errorMessage },
        'Moved failed file to error directory'
      );
    } catch (error) {
      this.logger.error({ filePath, error }, 'Failed to move file to error directory');
    }
  }

  /**
   * Get active jobs count
   */
  getActiveJobsCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Get all active jobs
   */
  getActiveJobs(): ProcessingJob[] {
    return Array.from(this.activeJobs.values());
  }
}
