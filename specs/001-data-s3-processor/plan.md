# Implementation Plan: Data File Processor with S3 Upload

**Branch**: `001-data-s3-processor` | **Date**: 2025-11-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-data-s3-processor/spec.md`

## Summary

Console application that monitors a local directory for files, automatically extracts archives, converts database files (CSV/JSON/XML) to compressed Parquet format, and uploads all processed files to S3 storage. The system operates with zero disk footprint (streaming/in-memory only) and includes crash recovery via persistent progress tracking.

**Key Technical Approach**:
- TypeScript for type safety and modern async/await patterns
- Streaming architecture throughout (no temporary files)
- DuckDB for efficient database-to-Parquet conversion
- SQLite for crash-resilient progress tracking
- Event-driven file monitoring with write-completion detection

## Technical Context

**Language/Version**: TypeScript 5.3+, Node.js 20.x LTS
**Primary Dependencies**:
- S3: `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (streaming multipart uploads)
- Parquet: `duckdb` (all-in-one CSV/JSON/XML → Parquet with compression)
- Archives: `unzipper` (ZIP), `tar-stream` (TAR/GZ)
- Monitoring: `chokidar` (file system watcher with write-completion detection)
- Progress: `better-sqlite3` (ACID-compliant progress tracking)
- Logging: `pino` (high-performance structured logging)

**Storage**:
- SQLite (progress tracking state, <1MB)
- S3-compatible object storage (AWS S3, MinIO)

**Testing**: Jest with TypeScript support
**Target Platform**: Linux/macOS server (Docker containerized)
**Project Type**: Single console application (CLI entry point)

**Performance Goals**:
- Process 100+ files/hour on standard hardware
- <2 minutes upload time for files <100MB
- 60%+ compression ratio for database files
- <1 second progress state updates

**Constraints**:
- ZERO disk footprint (no temp files except small SQLite DB)
- All processing via streaming or in-memory
- Minimum 512MB RAM for in-memory buffers
- Crash-resilient (resumable from any point)

**Scale/Scope**:
- Handle files up to 10GB (streaming)
- Support thousands of files in monitoring queue
- 30 days continuous uptime without crashes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: N/A - No project constitution defined yet

The project template constitution is not filled in. Proceeding without constitution gates.

## Project Structure

### Documentation (this feature)

```text
specs/001-data-s3-processor/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output - library decisions (COMPLETE)
├── data-model.md        # Phase 1 output - entity definitions
├── quickstart.md        # Phase 1 output - test scenarios
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── index.ts                 # CLI entry point, orchestration
├── config/
│   └── config.ts            # .env loader, configuration types
├── models/
│   ├── FileMetadata.ts      # File info (path, size, hash, type)
│   ├── ProgressRecord.ts    # Progress tracking state
│   └── ProcessingJob.ts     # Processing job state machine
├── services/
│   ├── FileMonitor.ts       # Chokidar wrapper, file detection
│   ├── ProgressTracker.ts   # SQLite progress persistence
│   ├── ArchiveExtractor.ts  # Stream-based archive extraction
│   ├── ParquetConverter.ts  # DuckDB-based Parquet conversion
│   ├── S3Uploader.ts        # AWS SDK streaming uploads
│   └── FileProcessor.ts     # Main orchestration (combines all services)
├── lib/
│   ├── logger.ts            # Pino logger setup
│   ├── streams.ts           # Stream utilities (piping, transforms)
│   └── checksum.ts          # File checksum calculation
└── types/
    └── index.ts             # Shared TypeScript types

tests/
├── unit/
│   ├── services/            # Unit tests for each service
│   └── lib/                 # Util testing tests
└── integration/
    ├── file-processing.test.ts      # End-to-end processing scenarios
    ├── crash-recovery.test.ts       # Restart and recovery scenarios
    └── archive-extraction.test.ts   # Archive format compatibility

.env.example                 # Example configuration
package.json                 # Dependencies and scripts
tsconfig.json                # TypeScript configuration
jest.config.js               # Jest testing configuration
Dockerfile                   # Container image for deployment
docker-compose.yml           # Local testing with MinIO
```

**Structure Decision**: Single console application. All code lives in `src/` with clear separation between:
- **models**: Data structures and types
- **services**: Business logic components (single responsibility)
- **lib**: Reusable utilities
- **config**: Environment and configuration loading

This structure supports:
1. Independent testing of each service
2. Clear dependency graph (services → models, lib)
3. Easy CLI orchestration in `index.ts`

## Component Breakdown

### Core Services

**FileMonitor** (`src/services/FileMonitor.ts`)
- Wraps `chokidar` for file system watching
- Detects: new files, modifications, write completion
- Emits events when files are ready for processing
- Filters: ignores dotfiles, checks file completeness

**ProgressTracker** (`src/services/ProgressTracker.ts`)
- Manages SQLite database for progress state
- Schema: file_path (unique), status, checksum, s3_key, timestamps
- Operations: record start, update progress, mark complete/failed
- Startup: rebuild state by comparing local files with S3
- Atomic updates: each operation in a transaction

**ArchiveExtractor** (`src/services/ArchiveExtractor.ts`)
- Detects archive format by extension + magic bytes
- Streaming extraction:
  - ZIP: `unzipper.Parse()` → stream entries
  - TAR/GZ: `tar-stream` → stream entries
- Yields: `{ path, stream }` for each file in archive
- No temp files: streams directly from archive to next stage

**ParquetConverter** (`src/services/ParquetConverter.ts`)
- Detects database files: `.csv`, `.tsv`, `.json`, `.xml`, `.jsonl`
- Uses DuckDB to convert to Parquet with ZSTD compression
- Streaming mode for large files (>100MB)
- Returns: Readable stream of Parquet data
- Preserves data types via DuckDB's auto-inference

**S3Uploader** (`src/services/S3Uploader.ts`)
- AWS SDK `Upload` class for multipart streaming
- Verifies upload integrity (checksums/ETags)
- Sets metadata: content-type, completion marker
- Retry logic: exponential backoff on failures
- Cleanup: detects and deletes incomplete uploads on startup

**FileProcessor** (`src/services/FileProcessor.ts`)
- Orchestrates: Monitor → Extract (if archive) → Convert (if DB) → Upload
- Processing pipeline:
  1. Check progress tracker (skip if complete)
  2. Calculate checksum
  3. Detect file type (archive/database/regular)
  4. Process:
     - Archive: Extract → process each entry recursively
     - Database: Convert to Parquet → upload
     - Regular: Upload directly
  5. Update progress tracker
- Error handling: catch, log, move to error directory
- Concurrency: process multiple files in parallel (configurable limit)

### Supporting Libraries

**logger** (`src/lib/logger.ts`)
- Pino configuration: JSON in production, pretty in dev
- Child loggers with context (e.g., `{ fileId, filePath }`)
- Log levels: DEBUG, INFO, WARN, ERROR

**streams** (`src/lib/streams.ts`)
- Stream utilities: pipe with error handling, transform streams
- PassThrough stream for monitoring upload progress

**checksum** (`src/lib/checksum.ts`)
- Calculate SHA256 checksums from streams
- Used for: file change detection, upload integrity

### Configuration

**config** (`src/config/config.ts`)
- Loads from `.env`: S3 credentials, bucket, region, monitored path
- Optional settings: concurrency, retry attempts, log level
- Validation: ensures required vars present, paths exist

## Data Flow

```text
File Added to /data
        ↓
FileMonitor detects (awaitWriteFinish)
        ↓
FileProcessor checks ProgressTracker
        ↓
    ┌─[Already processed]─→ Skip
    │
    └─[Not processed]─→ Calculate checksum
                              ↓
                         Detect file type
                              ↓
                    ┌─────────┼─────────┐
                    ↓         ↓         ↓
                [Archive]  [Database]  [Regular]
                    ↓         ↓         ↓
          ArchiveExtractor  ParquetConverter  Direct stream
                    ↓         ↓         ↓
              (for each    Convert to    Stream to
               entry)       Parquet      S3Uploader
                    ↓         ↓         ↓
                ┌───┴─────────┴─────────┘
                ↓
          S3Uploader.upload(stream)
                ↓
          Verify integrity
                ↓
         Set completion marker
                ↓
         ProgressTracker.markComplete()
                ↓
              Done
```

## Crash Recovery Flow

```text
Application Startup
        ↓
Load progress state from SQLite
        ↓
Query S3 for all objects
        ↓
Compare local files vs S3 objects vs progress DB
        ↓
    ┌───┴────┐
    ↓        ↓
[In Progress | Incomplete]
    ↓
Delete from S3 (cleanup)
    ↓
Mark as pending in progress DB
    ↓
Process normally
```

## Success Metrics

From spec.md success criteria:

- **SC-001**: Files to S3 in <2min (files <100MB)
- **SC-002**: 60%+ Parquet compression
- **SC-003**: 100+ files/hour throughput
- **SC-004**: 99.5% upload success rate
- **SC-011**: Zero temporary files (verified)
- **SC-012**: Resume within 30s after crash
- **SC-013**: 100% incomplete upload cleanup
- **SC-014**: Progress updates <1s after upload

## Phase 0 Artifacts

✅ **research.md** - Library decisions (COMPLETE)
- S3: AWS SDK v3
- Parquet: DuckDB
- Archives: unzipper, tar-stream
- Monitoring: chokidar
- Progress: better-sqlite3
- Logging: pino

## Phase 1 Artifacts

📝 Next: Generate data-model.md, quickstart.md

## Complexity Tracking

No constitution violations to justify.
