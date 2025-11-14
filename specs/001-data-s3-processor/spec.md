# Feature Specification: Data File Processor with S3 Upload

**Feature Branch**: `001-data-s3-processor`
**Created**: 2025-11-14
**Status**: Draft
**Input**: User description: "Console application that monitors local folder for files, extracts archives, converts database files to Parquet, and uploads to S3"

## Critical Constraints

**ZERO-DISK-FOOTPRINT OPERATION**: This system operates in an environment with extremely limited disk space. The application MUST NOT create any temporary files on disk during processing. All operations (archive extraction, format conversion, S3 upload) MUST use streaming or in-memory processing exclusively.

**CRASH RESILIENCE**: The application must be restartable and resumable. If the process is stopped or crashes, it must resume from the correct point on restart, skipping already-processed files and cleaning up incomplete uploads.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Basic File Upload to S3 (Priority: P1)

A system administrator sets up the application to monitor a local directory and automatically upload files to S3 storage as they arrive. This provides automated backup and cloud storage of incoming data files.

**Why this priority**: This is the foundational capability - without basic file monitoring and S3 upload, no other features can work. This delivers immediate value by automating file transfers.

**Independent Test**: Can be fully tested by placing a single non-archive file in the monitored directory and verifying it appears in S3 with the correct folder structure.

**Acceptance Scenarios**:

1. **Given** the application is running and monitoring /data, **When** a new file is copied to /data/documents/report.pdf, **Then** the file appears in S3 at the same path structure within 30 seconds of copy completion
2. **Given** a file is currently being written to the monitored directory, **When** the application detects the file, **Then** it waits until the file write is complete before processing
3. **Given** the application successfully uploads a file to S3, **When** the upload completes, **Then** the application logs the successful upload with timestamp and file path

---

### User Story 2 - Crash Recovery and Progress Tracking (Priority: P2)

The application must survive crashes and restarts without losing progress or creating duplicate uploads. When restarted, it skips already-processed files and cleans up any incomplete uploads from previous runs.

**Why this priority**: Production reliability requires the ability to recover from crashes, power failures, or intentional restarts. Without this, every restart would re-process all files, wasting bandwidth and creating duplicates.

**Independent Test**: Can be tested by starting the application, processing several files, forcefully terminating the process during an upload, restarting, and verifying that completed files are skipped and the incomplete upload is cleaned up and retried.

**Acceptance Scenarios**:

1. **Given** the application has successfully uploaded 5 files to S3, **When** the application restarts, **Then** it skips those 5 files and only processes new files
2. **Given** the application crashes during an upload, **When** the application restarts, **Then** it detects the incomplete upload, removes it from S3, and retries the upload from the beginning
3. **Given** files in the monitored directory already exist in S3, **When** the application starts, **Then** it marks those files as already processed and does not re-upload them
4. **Given** the application is processing files, **When** it records progress after each successful upload, **Then** the progress state is persisted immediately (not buffered)

---

### User Story 3 - Database File Conversion to Parquet (Priority: P3)

When database export files (CSV, TSV, JSON, XML) are placed in the monitored directory, they are automatically converted to compressed Parquet format before upload. This reduces storage costs and network transfer time.

**Why this priority**: Parquet conversion provides the key optimization benefit - reducing file sizes by 70-90% for typical database exports. This should work independently of archive extraction.

**Independent Test**: Can be tested by placing a CSV file in the monitored directory and verifying that only a Parquet version (not the original CSV) appears in S3, with significantly smaller file size.

**Acceptance Scenarios**:

1. **Given** a 100MB CSV file is placed in the monitored directory, **When** the application processes it, **Then** a compressed Parquet file appears in S3 at the same path (with .parquet extension) and no CSV file is uploaded
2. **Given** a database file contains 1 million rows, **When** converted to Parquet, **Then** all rows are preserved accurately with correct data types
3. **Given** the monitored directory contains both database files and regular files, **When** the application processes them, **Then** only database files are converted to Parquet while other files are uploaded unchanged

---

### User Story 4 - Archive Extraction and Processing (Priority: P4)

When archive files (ZIP, RAR, TAR, GZ, etc.) are placed in the monitored directory, they are automatically extracted and their contents are uploaded to S3. Database files within archives are converted to Parquet.

**Why this priority**: Archive handling enables bulk data processing workflows. It depends on the database conversion logic from P2, making it a natural third priority.

**Independent Test**: Can be tested by placing a ZIP file containing multiple files (including at least one CSV) in the monitored directory and verifying that extracted contents appear in S3 with database files as Parquet.

**Acceptance Scenarios**:

1. **Given** a ZIP archive containing 5 files is placed in the monitored directory, **When** the application processes it, **Then** all 5 files appear in S3 in extracted form (not as a ZIP file)
2. **Given** an archive contains CSV files and PDF files, **When** extracted and processed, **Then** CSV files appear as Parquet in S3 while PDF files appear unchanged
3. **Given** an archive with nested folder structure, **When** extracted, **Then** the same folder structure is preserved in S3
4. **Given** a password-protected archive, **When** the application attempts to extract it, **Then** it logs an error and skips the file

---

### Edge Cases

- What happens when a file already exists in S3 at the target path? (Check if it's marked as complete in progress tracking; if yes, skip; if no or not tracked, re-upload and update tracking)
- What happens when S3 connection is lost during upload? (System should retry with exponential backoff, mark upload as incomplete)
- What happens when the application crashes during an upload? (On restart, detect incomplete upload in S3, delete it, retry from beginning, update progress tracking)
- What happens when the progress tracking state becomes corrupted? (Fallback to comparing with S3 directly, rebuild progress state from S3 inventory)
- What happens when an archive is corrupted or cannot be extracted? (Log error, move file to error directory, mark as failed in progress tracking, continue processing)
- What happens when a database file has invalid/corrupted data? (Log error with row numbers, skip file, mark as failed in progress tracking, continue processing)
- What happens when available memory is low during processing? (Use streaming mode with smaller buffers, process one file at a time if needed)
- What happens when the monitored directory is deleted or becomes inaccessible? (Log error, attempt to reconnect periodically, maintain progress tracking)
- What happens with very large files (>10GB)? (Use streaming processing with direct S3 upload, no disk buffering, frequent progress updates)
- What happens when multiple files arrive simultaneously? (Process in parallel up to configurable limit based on available memory, queue excess)
- What happens when streaming an archive entry that contains another nested archive? (Extract inner archive in-memory or stream nested contents)
- What happens when progress tracking file is missing on startup? (Rebuild by comparing monitored directory with S3 contents)
- What happens when a file is modified in the monitored directory after being uploaded? (Detect modification via timestamp/checksum, re-process and re-upload)

## Requirements *(mandatory)*

### Functional Requirements

#### Configuration
- **FR-001**: System MUST read configuration from .env file at startup
- **FR-002**: Configuration MUST include S3 bucket name, region, access credentials, and endpoint URL
- **FR-003**: Configuration MUST include local directory path to monitor
- **FR-004**: Configuration MUST support optional settings for: max concurrent uploads, retry attempts, file size limits, and parallel processing threads

#### File Monitoring
- **FR-005**: System MUST monitor the configured local directory for new files and file modifications
- **FR-006**: System MUST detect when a file write operation is complete before processing (no partial file processing)
- **FR-007**: System MUST support monitoring subdirectories recursively
- **FR-008**: System MUST process files in the order they become available

#### Progress Tracking & Crash Recovery

- **FR-009**: System MUST maintain persistent state of processed files to support crash recovery
- **FR-010**: System MUST record file processing status: pending, in-progress, completed, failed
- **FR-011**: System MUST update progress state immediately after successful upload (not buffered)
- **FR-012**: System MUST verify on startup which files have already been successfully uploaded to S3
- **FR-013**: System MUST skip re-processing files that are marked as completed in progress tracking
- **FR-014**: System MUST detect incomplete uploads in S3 on startup (files without completion marker)
- **FR-015**: System MUST clean up incomplete uploads by deleting them from S3 before retry
- **FR-016**: System MUST support rebuilding progress state by comparing monitored directory with S3 contents
- **FR-017**: System MUST use minimal disk space for progress tracking (small database or metadata file only)
- **FR-018**: System MUST detect file modifications via checksum or timestamp comparison
- **FR-019**: System MUST re-process and re-upload modified files even if previously marked as completed

#### Archive Handling

- **FR-020**: System MUST detect archive files by extension and magic number validation
- **FR-021**: System MUST support extraction of ZIP, TAR, GZ, BZ2, XZ, and 7Z archive formats
- **FR-022**: System SHOULD support RAR archive extraction if system tools are available
- **FR-023**: System MUST stream archive contents directly from archive files without extracting to disk
- **FR-024**: System MUST process each file within an archive in-memory or with minimal temporary storage
- **FR-025**: Archive contents MUST maintain their original directory structure in S3
- **FR-026**: The original archive file MUST NOT be uploaded to S3 (only extracted contents)
- **FR-027**: System MUST read archive entries sequentially and upload to S3 without creating intermediate files

#### Database File Processing

- **FR-028**: System MUST detect database files by extension: .csv, .tsv, .json, .xml, .jsonl
- **FR-029**: System MUST convert detected database files to Parquet format with compression (Snappy or ZSTD)
- **FR-030**: Parquet conversion MUST preserve all data accurately including data types
- **FR-031**: System MUST handle large database files using streaming/chunked processing without writing intermediate files
- **FR-032**: Original database files MUST NOT be uploaded to S3 (only Parquet versions)
- **FR-033**: Converted Parquet files MUST use the same filename with .parquet extension
- **FR-034**: System MUST convert database files to Parquet in-memory when possible, using streaming for large files

#### S3 Upload

- **FR-035**: System MUST upload files to S3 using the configured bucket and credentials
- **FR-036**: System MUST preserve the directory structure from the monitored folder in S3
- **FR-037**: System MUST verify upload integrity using checksums or ETags
- **FR-038**: System MUST retry failed uploads up to the configured limit with exponential backoff
- **FR-039**: System MUST support streaming uploads directly to S3 without creating local copies
- **FR-040**: System MUST set appropriate content-type metadata on uploaded files
- **FR-041**: System MUST mark S3 uploads as complete only after successful integrity verification

#### Error Handling & Logging

- **FR-042**: System MUST log all processing activities including: file detected, processing started, upload completed, errors encountered
- **FR-043**: System MUST continue processing other files when one file fails
- **FR-044**: System MUST move failed files to an error directory for manual review
- **FR-045**: Error logs MUST include timestamp, file path, error type, and error details
- **FR-046**: System MUST provide configurable log levels (DEBUG, INFO, WARN, ERROR)

#### Performance & Resource Management

- **FR-047**: System MUST support concurrent processing of multiple files up to configured limit
- **FR-048**: System MUST limit memory usage during file processing to prevent system overload
- **FR-049**: System MUST use streaming processing to minimize memory footprint for large files
- **FR-050**: System MUST NOT create temporary files on disk during processing (zero-disk-footprint operation)

### Key Entities

- **Monitored File**: Represents a file detected in the monitored directory, with attributes: path, size, type (archive/database/regular), detection timestamp, processing status, checksum/hash, last modified time
- **Processing Job**: Represents the work to process a single file, with attributes: file reference, steps completed, current status, retry count, error messages, start time, completion time
- **S3 Upload Task**: Represents an upload operation, with attributes: source file path, destination S3 key, upload progress, checksum, completion status, completion marker
- **Progress Record**: Represents the persistent state of a processed file, with attributes: file path, file checksum, processing status (pending/in-progress/completed/failed), S3 destination path, timestamp, error details if failed
- **Configuration**: Settings loaded from .env, with attributes: S3 credentials, bucket name, local directory path, processing limits, retry policies, progress tracking location

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Files placed in the monitored directory appear in S3 within 2 minutes for files under 100MB
- **SC-002**: Database files are converted to Parquet format with at least 60% size reduction on average
- **SC-003**: System successfully processes at least 100 files per hour on standard hardware
- **SC-004**: System achieves 99.5% upload success rate under normal network conditions
- **SC-005**: Archive extraction preserves 100% of file contents with correct folder structure
- **SC-006**: System handles files up to 10GB without manual intervention using streaming processing
- **SC-007**: Application continues running for 30 days without crashes or memory leaks
- **SC-008**: All processing activities are logged with sufficient detail for troubleshooting
- **SC-009**: System recovers automatically from temporary S3 connection failures within 5 minutes
- **SC-010**: Failed files are moved to error directory with error details logged for 95% of failures
- **SC-011**: System creates zero temporary files on disk during all processing operations (verified via filesystem monitoring)
- **SC-012**: After crash and restart, system resumes within 30 seconds and skips all previously completed files
- **SC-013**: System detects and cleans up 100% of incomplete uploads on restart
- **SC-014**: Progress tracking state updates complete within 1 second of successful upload
- **SC-015**: System correctly identifies file modifications and re-processes changed files within 2 minutes of modification

## Assumptions

- S3 credentials provided in .env have sufficient permissions for bucket operations (put, get, list, delete for cleanup)
- The monitored directory is on a local or network-mounted filesystem accessible to the application
- Archive files are not encrypted or password-protected (encrypted archives will be logged as errors)
- Database files use standard encodings (UTF-8 for text files)
- Network connectivity to S3 is generally reliable with occasional temporary outages
- System has sufficient RAM to buffer at least one file in memory during processing (minimum 512MB available)
- Standard archive formats (ZIP, TAR, GZ) are prioritized; RAR support is best-effort
- The application has read/write permissions for the monitored directory, error directory, and progress tracking file/database
- File names do not conflict when preserving directory structure in S3 (or overwrite is acceptable)
- Disk space is extremely limited - system must operate with zero temporary file creation (except small progress tracking metadata)
- All processing (archive extraction, format conversion, upload) happens in-memory or via streaming
- Progress tracking metadata file is small enough to fit in available disk space (typically <1MB for thousands of files)
- Files in the monitored directory are not deleted by external processes while being processed
- S3 supports object metadata or tags for marking upload completion status

## Dependencies

- S3-compatible storage service (AWS S3, MinIO, etc.) must be accessible
- .env file must exist and contain required configuration before application starts
- System must have libraries supporting streaming archive extraction (no external tools requiring disk extraction)
- Sufficient RAM for in-memory processing buffers (minimum 512MB recommended)
- Persistent storage for progress tracking metadata (small file or lightweight database)
- S3 service supports object metadata, tags, or multipart upload tracking for completion markers

## Out of Scope

- User interface (this is a console application with log output only)
- File encryption before upload to S3
- Database schema validation or data quality checks
- Support for proprietary database formats (e.g., Oracle dumps, SQL Server backups)
- File deduplication or incremental uploads
- Webhook or notification system for processing events
- Processing files already in S3 (only monitors local directory)
- Bidirectional sync (S3 to local)
