// ============================================================================
// Enums
// ============================================================================

export enum FileType {
  ARCHIVE = 'archive',
  DATABASE = 'database',
  REGULAR = 'regular'
}

export enum ProcessingStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum UploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum ProcessingStep {
  CHECKSUM_CALCULATION = 'checksum_calculation',
  TYPE_DETECTION = 'type_detection',
  ARCHIVE_EXTRACTION = 'archive_extraction',
  PARQUET_CONVERSION = 'parquet_conversion',
  S3_UPLOAD = 's3_upload',
  INTEGRITY_VERIFICATION = 'integrity_verification',
  PROGRESS_UPDATE = 'progress_update'
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface MonitoringConfig {
  watchPath: string;
  stabilityThreshold: number;
  pollInterval: number;
  ignoreInitial: boolean;
}

export interface ProcessingConfig {
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;
  errorDirectory: string;
  progressDbPath: string;
  parquetCompression: 'ZSTD' | 'SNAPPY';
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty: boolean;
}

export interface AppConfig {
  s3: S3Config;
  monitoring: MonitoringConfig;
  processing: ProcessingConfig;
  logging: LoggingConfig;
}

// ============================================================================
// Archive Extension Mappings
// ============================================================================

export const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.tar',
  '.gz',
  '.tar.gz',
  '.tgz',
  '.bz2',
  '.xz'
] as const;

export const DATABASE_EXTENSIONS = [
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.jsonl'
] as const;

// ============================================================================
// Type Guards
// ============================================================================

export function isArchiveFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

export function isDatabaseFile(filename: string): boolean {
  const lowerName = filename.toLowerCase();
  return DATABASE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
}

export function getFileType(filename: string): FileType {
  if (isArchiveFile(filename)) {
    return FileType.ARCHIVE;
  }
  if (isDatabaseFile(filename)) {
    return FileType.DATABASE;
  }
  return FileType.REGULAR;
}
