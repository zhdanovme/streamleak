# Data Model: Data File Processor

**Feature**: 001-data-s3-processor
**Created**: 2025-11-15

## Overview

This document defines the key entities and data structures for the file processing system. All entities are designed for in-memory processing with minimal persistent storage (SQLite progress DB only).

## Core Entities

### 1. FileMetadata

**Purpose**: Represents a file detected in the monitored directory

**Attributes**:
- `path` (string): Absolute file path
- `relativePath` (string): Path relative to monitored directory
- `size` (number): File size in bytes
- `type` (FileType): Enum - 'archive', 'database', 'regular'
- `extension` (string): File extension (e.g., '.csv', '.zip')
- `checksum` (string): SHA256 hash of file contents
- `modifiedAt` (Date): Last modification timestamp
- `detectedAt` (Date): When file was detected by monitor

**FileType Enum**:
```typescript
enum FileType {
  ARCHIVE = 'archive',     // .zip, .tar, .gz, .tar.gz, .tgz
  DATABASE = 'database',   // .csv, .tsv, .json, .xml, .jsonl
  REGULAR = 'regular'      // All other files
}
```

**Relationships**:
- One FileMetadata → One ProcessingJob
- One FileMetadata → One ProgressRecord (persisted)

**Validation Rules**:
- `path` must be absolute and exist
- `size` must be >= 0
- `checksum` computed lazily (only when needed for change detection)
- `type` determined by extension and magic number validation

---

### 2. ProgressRecord

**Purpose**: Persistent state of processed files (stored in SQLite)

**Attributes**:
- `id` (number): Auto-increment primary key
- `filePath` (string): Absolute file path (UNIQUE)
- `status` (ProcessingStatus): Current processing state
- `sizeBytes` (number | null): Total file size
- `processedBytes` (number | null): Bytes uploaded so far (for progress tracking)
- `checksum` (string | null): SHA256 hash (for change detection)
- `s3Key` (string | null): S3 object key where file was uploaded
- `errorMessage` (string | null): Error details if status is 'failed'
- `createdAt` (number): Unix timestamp when record created
- `updatedAt` (number): Unix timestamp of last update

**ProcessingStatus Enum**:
```typescript
enum ProcessingStatus {
  PENDING = 'pending',         // Detected but not started
  IN_PROGRESS = 'in_progress', // Currently processing/uploading
  COMPLETED = 'completed',     // Successfully uploaded
  FAILED = 'failed'            // Processing failed (moved to error dir)
}
```

**Database Schema** (SQLite):
```sql
CREATE TABLE IF NOT EXISTS file_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
  size_bytes INTEGER,
  processed_bytes INTEGER,
  checksum TEXT,
  s3_key TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_path ON file_progress(file_path);
CREATE INDEX IF NOT EXISTS idx_status ON file_progress(status);
CREATE INDEX IF NOT EXISTS idx_updated_at ON file_progress(updated_at);
```

**Relationships**:
- One ProgressRecord ← One FileMetadata
- ProgressRecord is the **source of truth** for crash recovery

**State Transitions**:
```text
PENDING → IN_PROGRESS → COMPLETED
                ↓
              FAILED

Transitions:
- PENDING → IN_PROGRESS: When processing starts
- IN_PROGRESS → COMPLETED: After successful S3 upload + verification
- IN_PROGRESS → FAILED: On unrecoverable error
- FAILED → PENDING: On manual retry (future feature)
```

**Validation Rules**:
- `filePath` must be unique (enforced by database)
- `status` must be valid enum value
- `updatedAt` updates automatically on every change
- `checksum` required for change detection (to re-process modified files)
- `s3Key` required when status is 'completed'

---

### 3. Processing Job

**Purpose**: Runtime state machine for a single file's processing

**Attributes**:
- `id` (string): UUID for this processing job
- `file` (FileMetadata): The file being processed
- `status` (ProcessingStatus): Current status (in-memory)
- `steps` (ProcessingStep[]): Steps completed so far
- `currentStep` (ProcessingStep | null): Currently executing step
- `retryCount` (number): Number of retry attempts
- `startTime` (Date): When processing started
- `endTime` (Date | null): When processing completed/failed
- `error` (Error | null): Error if processing failed

**ProcessingStep Enum**:
```typescript
enum ProcessingStep {
  CHECKSUM_CALCULATION = 'checksum_calculation',
  TYPE_DETECTION = 'type_detection',
  ARCHIVE_EXTRACTION = 'archive_extraction',
  PARQUET_CONVERSION = 'parquet_conversion',
  S3_UPLOAD = 'streaming',
  INTEGRITY_VERIFICATION = 'integrity_verification',
  PROGRESS_UPDATE = 'progress_update'
}
```

**Relationships**:
- One ProcessingJob ← One FileMetadata
- One ProcessingJob → Many S3UploadTasks (if archive with multiple files)

**Lifecycle**:
1. Created when file detected
2. Checks ProgressRecord (skip if completed)
3. Executes steps in order (based on file type)
4. Updates ProgressRecord after each major step
5. Destroyed after completion

**Validation Rules**:
- `retryCount` max 3 (configurable)
- Steps executed in order (cannot skip)
- `error` set only when status is 'failed'

---

### 4. S3UploadTask

**Purpose**: Represents a single S3 upload operation

**Attributes**:
- `id` (string): UUID for this upload
- `sourceFilePath` (string): Local file or stream source
- `s3Key` (string): S3 object key (destination path)
- `bucket` (string): S3 bucket name
- `contentType` (string): MIME type
- `size` (number | null): Total bytes to upload (null if streaming)
- `uploadedBytes` (number): Bytes uploaded so far
- `uploadId` (string | null): Multipart upload ID (for resumption)
- `etag` (string | null): S3 ETag after upload
- `checksum` (string | null): SHA256 for verification
- `metadata` (Record<string, string>): Custom S3 metadata
- `status` (UploadStatus): Current upload state
- `error` (Error | null): Error if upload failed

**UploadStatus Enum**:
```typescript
enum UploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  FAILED = 'failed'
}
```

**Relationships**:
- One S3UploadTask ← One ProcessingJob (for regular/database files)
- Many S3UploadTasks ← One ProcessingJob (for archives with multiple entries)

**Validation Rules**:
- `s3Key` preserves directory structure from monitored folder
- `metadata` includes completion marker (e.g., `{ 'x-completed': 'true' }`)
- `etag` must match for completed uploads
- Incomplete uploads (no completion marker) cleaned up on restart

---

### 5. Configuration

**Purpose**: Application configuration loaded from .env

**Attributes**:
- `s3` (S3Config): S3 connection settings
- `monitoring` (MonitoringConfig): File monitoring settings
- `processing` (ProcessingConfig): Processing behavior
- `logging` (LoggingConfig): Logging configuration

**S3Config**:
```typescript
interface S3Config {
  endpoint: string;           // S3 endpoint URL
  region: string;             // AWS region
  bucket: string;             // Target bucket name
  accessKeyId: string;        // AWS access key
  secretAccessKey: string;    // AWS secret key
  forcePathStyle: boolean;    // For MinIO compatibility
}
```

**MonitoringConfig**:
```typescript
interface MonitoringConfig {
  watchPath: string;                // Absolute path to monitor (e.g., '/data')
  stabilityThreshold: number;       // Ms to wait for write completion (default: 2000)
  pollInterval: number;             // File size check interval (default: 100)
  ignoreInitial: boolean;           // Skip files present at startup (default: false)
}
```

**ProcessingConfig**:
```typescript
interface ProcessingConfig {
  maxConcurrency: number;           // Max parallel file processing (default: 4)
  maxRetries: number;               // Max retry attempts (default: 3)
  retryDelay: number;               // Initial retry delay in ms (default: 1000)
  errorDirectory: string;           // Path for failed files (default: '/data/errors')
  progressDbPath: string;           // SQLite database path (default: './progress.db')
  parquetCompression: 'ZSTD' | 'SNAPPY';  // Compression type (default: 'ZSTD')
}
```

**LoggingConfig**:
```typescript
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';  // Log level (default: 'info')
  pretty: boolean;                  // Use pino-pretty in dev (default: NODE_ENV !== 'production')
}
```

**Validation Rules**:
- All S3 credentials must be non-empty
- `watchPath` must exist and be readable
- `errorDirectory` must be writable
- `maxConcurrency` must be > 0
- `parquetCompression` must be supported by DuckDB

---

## Entity Relationships Diagram

```text
FileMetadata (in-memory)
    ↓ 1:1
ProcessingJob (in-memory runtime state)
    ↓ 1:1 or 1:N (if archive)
S3UploadTask (in-memory)
    ↓
ProgressRecord (SQLite - persisted)


FileMonitor
    ↓ emits
FileMetadata
    ↓ creates
ProcessingJob
    ↓ checks
ProgressRecord (SQLite)
    ↓ if not completed
Process File
    ↓ creates
S3UploadTask(s)
    ↓ on success
Update ProgressRecord → COMPLETED
```

## Storage Requirements

**In-Memory**:
- FileMetadata: ~500 bytes per file
- ProcessingJob: ~1KB per job (includes steps, errors)
- S3UploadTask: ~2KB per upload

**Persistent (SQLite)**:
- ProgressRecord: ~200 bytes per file
- Indexes: ~100 bytes per file
- **Total for 1000 files**: ~300KB
- **Total for 10,000 files**: ~3MB

**Memory Footprint**:
- For 100 files in processing queue: ~350KB in-memory
- For 1000 files tracked: ~3MB SQLite + ~3.5MB in-memory
- Streaming buffers: 8MB per concurrent upload (configurable)
- Total estimated: < 100MB for normal operation

## Data Lifecycle

### File Detection → Completion

1. **FileMonitor** detects file → creates **FileMetadata**
2. **FileProcessor** creates **ProcessingJob** with FileMetadata
3. ProcessingJob checks **ProgressRecord** (skip if completed)
4. If not processed:
   - Insert ProgressRecord with status='pending'
   - Update to status='in_progress'
   - Process file (extract, convert, upload)
   - Create **S3UploadTask**(s)
   - Upload streams to S3
   - Update ProgressRecord to status='completed' + s3Key
5. ProcessingJob destroyed (in-memory cleanup)
6. FileMetadata garbage collected

### Crash Recovery

1. Application starts
2. **ProgressTracker** loads all ProgressRecords from SQLite
3. Query S3 for all objects
4. For each ProgressRecord with status='in_progress':
   - Check S3 for completion marker
   - If incomplete or missing: Delete from S3, set status='pending'
   - If complete: Set status='completed'
5. Resume processing from 'pending' records

## Type Definitions Reference

All TypeScript interfaces and enums defined above will be implemented in:
- `src/models/FileMetadata.ts`
- `src/models/ProgressRecord.ts`
- `src/models/ProcessingJob.ts`
- `src/types/index.ts` (shared types and enums)
