import { ProcessingStatus } from '../types/index.js';

export interface ProgressRecord {
  /** Auto-increment primary key */
  id?: number;

  /** Absolute file path (UNIQUE) */
  filePath: string;

  /** Current processing state */
  status: ProcessingStatus;

  /** Total file size */
  sizeBytes: number | null;

  /** Bytes uploaded so far (for progress tracking) */
  processedBytes: number | null;

  /** SHA256 hash (for change detection) */
  checksum: string | null;

  /** S3 object key where file was uploaded */
  s3Key: string | null;

  /** Error details if status is 'failed' */
  errorMessage: string | null;

  /** Unix timestamp when record created */
  createdAt: number;

  /** Unix timestamp of last update */
  updatedAt: number;
}

export function createProgressRecord(
  filePath: string,
  status: ProcessingStatus = ProcessingStatus.PENDING
): ProgressRecord {
  const now = Math.floor(Date.now() / 1000);

  return {
    filePath,
    status,
    sizeBytes: null,
    processedBytes: null,
    checksum: null,
    s3Key: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Database row type (from SQLite)
export interface ProgressRecordRow {
  id: number;
  file_path: string;
  status: string;
  size_bytes: number | null;
  processed_bytes: number | null;
  checksum: string | null;
  s3_key: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

// Convert database row to model
export function rowToProgressRecord(row: ProgressRecordRow): ProgressRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    status: row.status as ProcessingStatus,
    sizeBytes: row.size_bytes,
    processedBytes: row.processed_bytes,
    checksum: row.checksum,
    s3Key: row.s3_key,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
