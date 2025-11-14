import { UploadStatus } from '../types/index.js';

export interface S3UploadTask {
  /** UUID for this upload */
  id: string;

  /** Local file path or stream source */
  sourceFilePath: string;

  /** S3 object key (destination path) */
  s3Key: string;

  /** S3 bucket name */
  bucket: string;

  /** MIME type */
  contentType: string;

  /** Total bytes to upload (null if streaming unknown size) */
  size: number | null;

  /** Bytes uploaded so far */
  uploadedBytes: number;

  /** Multipart upload ID (for resumption) */
  uploadId: string | null;

  /** S3 ETag after upload */
  etag: string | null;

  /** SHA256 for verification */
  checksum: string | null;

  /** Custom S3 metadata */
  metadata: Record<string, string>;

  /** Current upload state */
  status: UploadStatus;

  /** Error if upload failed */
  error: Error | null;
}

export function createS3UploadTask(
  id: string,
  sourceFilePath: string,
  s3Key: string,
  bucket: string,
  contentType: string,
  size: number | null
): S3UploadTask {
  return {
    id,
    sourceFilePath,
    s3Key,
    bucket,
    contentType,
    size,
    uploadedBytes: 0,
    uploadId: null,
    etag: null,
    checksum: null,
    metadata: {},
    status: UploadStatus.PENDING,
    error: null,
  };
}
