# Tasks: Data File Processor with S3 Upload

**Input**: Design documents from `/specs/001-data-s3-processor/`
**Prerequisites**: plan.md, spec.md, data-model.md, research.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- All paths relative to repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Initialize TypeScript project with Node.js 20.x LTS and create package.json
- [ ] T002 [P] Install core dependencies: @aws-sdk/client-s3, @aws-sdk/lib-storage, duckdb, chokidar, unzipper, tar-stream, better-sqlite3, pino
- [ ] T003 [P] Install dev dependencies: @types/node, @types/better-sqlite3, @types/unzipper, pino-pretty, typescript, ts-node, jest, @types/jest
- [ ] T004 [P] Create tsconfig.json with ES2022 target, strict mode, and output to dist/
- [ ] T005 [P] Create .gitignore for node_modules/, dist/, *.db, .env, data/, errors/
- [ ] T006 Create project directory structure: src/{config,models,services,lib,types}, tests/{unit,integration}
- [ ] T007 [P] Create .env.example with all required environment variables (S3 config, paths, settings)
- [ ] T008 [P] Setup Jest configuration with TypeScript support in jest.config.js
- [ ] T009 [P] Create docker-compose.yml with MinIO for local S3 testing
- [ ] T010 [P] Create Dockerfile for containerized deployment
- [ ] T011 [P] Add npm scripts: dev, build, start, test in package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T012 [P] Create TypeScript type definitions for all enums (FileType, ProcessingStatus, UploadStatus, ProcessingStep) in src/types/index.ts
- [ ] T013 [P] Create Configuration interface and types in src/types/index.ts
- [ ] T014 Implement environment configuration loader in src/config/config.ts (reads .env, validates required vars)
- [ ] T015 [P] Implement Pino logger setup with dev/production modes in src/lib/logger.ts
- [ ] T016 [P] Implement stream utilities (piping with error handling, transform streams) in src/lib/streams.ts
- [ ] T017 [P] Implement SHA256 checksum calculation from streams in src/lib/checksum.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Basic File Upload to S3 (Priority: P1) 🎯 MVP

**Goal**: Monitor local directory for files and upload them to S3 automatically

**Independent Test**: Place a file in monitored directory → verify it appears in S3 within 30 seconds

### Implementation for User Story 1

- [ ] T018 [P] [US1] Create FileMetadata model interface in src/models/FileMetadata.ts
- [ ] T019 [P] [US1] Create S3UploadTask model interface in src/models/S3UploadTask.ts
- [ ] T020 [US1] Implement S3Client initialization with configuration in src/services/S3Uploader.ts
- [ ] T021 [US1] Implement streaming upload to S3 with multipart support in src/services/S3Uploader.ts
- [ ] T022 [US1] Implement upload integrity verification (checksum/ETag) in src/services/S3Uploader.ts
- [ ] T023 [US1] Implement retry logic with exponential backoff in src/services/S3Uploader.ts
- [ ] T024 [US1] Implement content-type detection and metadata setting in src/services/S3Uploader.ts
- [ ] T025 [US1] Implement FileMonitor service with chokidar in src/services/FileMonitor.ts (detect new files, wait for write completion)
- [ ] T026 [US1] Implement file type detection (archive/database/regular) in src/services/FileMonitor.ts
- [ ] T027 [US1] Create ProcessingJob model with state machine in src/models/ProcessingJob.ts
- [ ] T028 [US1] Implement basic FileProcessor orchestration (monitor → detect → upload) in src/services/FileProcessor.ts
- [ ] T029 [US1] Implement error handling and move failed files to error directory in src/services/FileProcessor.ts
- [ ] T030 [US1] Add structured logging for file detection, upload start, upload complete in src/services/FileProcessor.ts
- [ ] T031 [US1] Create CLI entry point in src/index.ts (load config, start FileMonitor, handle graceful shutdown)

**Checkpoint**: At this point, User Story 1 should be fully functional - files are detected and uploaded to S3

---

## Phase 4: User Story 2 - Crash Recovery and Progress Tracking (Priority: P2)

**Goal**: Enable crash resilience with progress tracking so the application can resume from any point

**Independent Test**: Upload 5 files → kill app during 6th upload → restart → verify 1-5 skipped, 6 retried

### Implementation for User Story 2

- [ ] T032 [P] [US2] Create ProgressRecord model interface in src/models/ProgressRecord.ts
- [ ] T033 [US2] Implement SQLite database initialization with WAL mode in src/services/ProgressTracker.ts
- [ ] T034 [US2] Create progress tracking schema (file_progress table with indexes) in src/services/ProgressTracker.ts
- [ ] T035 [US2] Implement prepared statements for insert/update/query operations in src/services/ProgressTracker.ts
- [ ] T036 [US2] Implement recordStart() method (insert pending record) in src/services/ProgressTracker.ts
- [ ] T037 [US2] Implement markInProgress() method (update to in_progress) in src/services/ProgressTracker.ts
- [ ] T038 [US2] Implement markComplete() method with atomic transaction in src/services/ProgressTracker.ts
- [ ] T039 [US2] Implement markFailed() method with error message in src/services/ProgressTracker.ts
- [ ] T040 [US2] Implement checkIsProcessed() lookup method in src/services/ProgressTracker.ts
- [ ] T041 [US2] Implement detectModifiedFiles() with checksum comparison in src/services/ProgressTracker.ts
- [ ] T042 [US2] Implement S3 completion marker (metadata tag) in src/services/S3Uploader.ts
- [ ] T043 [US2] Implement detectIncompleteUploads() by querying S3 metadata in src/services/S3Uploader.ts
- [ ] T044 [US2] Implement cleanupIncompleteUploads() deletion method in src/services/S3Uploader.ts
- [ ] T045 [US2] Implement rebuildProgressState() by comparing local files with S3 in src/services/ProgressTracker.ts
- [ ] T046 [US2] Add startup recovery logic to src/index.ts (load progress, detect incomplete uploads, rebuild state)
- [ ] T047 [US2] Integrate ProgressTracker into FileProcessor (check before processing, update after upload) in src/services/FileProcessor.ts
- [ ] T048 [US2] Add progress state updates with <1s latency in src/services/FileProcessor.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - app survives crashes and resumes correctly

---

## Phase 5: User Story 3 - Database File Conversion to Parquet (Priority: P3)

**Goal**: Automatically convert database files (CSV, JSON, XML) to compressed Parquet format before upload

**Independent Test**: Place a CSV file → verify only Parquet version in S3 with 60%+ compression

### Implementation for User Story 3

- [ ] T049 [P] [US3] Detect database file extensions (.csv, .tsv, .json, .xml, .jsonl) in src/services/FileProcessor.ts
- [ ] T050 [US3] Implement DuckDB connection initialization (in-memory) in src/services/ParquetConverter.ts
- [ ] T051 [US3] Implement CSV to Parquet conversion with ZSTD compression in src/services/ParquetConverter.ts
- [ ] T052 [US3] Implement JSON to Parquet conversion with ZSTD compression in src/services/ParquetConverter.ts
- [ ] T053 [US3] Implement XML to Parquet conversion (with spatial extension) in src/services/ParquetConverter.ts
- [ ] T054 [US3] Implement streaming mode for large files (>100MB) in src/services/ParquetConverter.ts
- [ ] T055 [US3] Implement data type inference and preservation in src/services/ParquetConverter.ts
- [ ] T056 [US3] Create Readable stream from Parquet output in src/services/ParquetConverter.ts
- [ ] T057 [US3] Implement file extension replacement (.csv → .parquet) in src/services/ParquetConverter.ts
- [ ] T058 [US3] Integrate ParquetConverter into FileProcessor pipeline (detect → convert → upload) in src/services/FileProcessor.ts
- [ ] T059 [US3] Ensure original database file NOT uploaded to S3 in src/services/FileProcessor.ts
- [ ] T060 [US3] Add logging for conversion start, progress, completion in src/services/ParquetConverter.ts

**Checkpoint**: All user stories 1-3 should now work - database files are converted before upload

---

## Phase 6: User Story 4 - Archive Extraction and Processing (Priority: P4)

**Goal**: Extract archive files and upload contents (with Parquet conversion for database files inside archives)

**Independent Test**: Place ZIP with CSV+PDF → verify extracted contents in S3, CSV as Parquet, no ZIP file

### Implementation for User Story 4

- [ ] T061 [P] [US4] Detect archive file extensions (.zip, .tar, .gz, .tar.gz, .tgz, .bz2, .xz) in src/services/FileProcessor.ts
- [ ] T062 [P] [US4] Implement magic number validation for archive format detection in src/services/ArchiveExtractor.ts
- [ ] T063 [US4] Implement ZIP streaming extraction with unzipper in src/services/ArchiveExtractor.ts
- [ ] T064 [US4] Implement TAR streaming extraction with tar-stream in src/services/ArchiveExtractor.ts
- [ ] T065 [US4] Implement GZ decompression with tar-stream in src/services/ArchiveExtractor.ts
- [ ] T066 [US4] Implement entry enumeration (yield {path, stream} for each file) in src/services/ArchiveExtractor.ts
- [ ] T067 [US4] Preserve directory structure from archive entries in src/services/ArchiveExtractor.ts
- [ ] T068 [US4] Implement nested archive detection and recursive extraction in src/services/ArchiveExtractor.ts
- [ ] T069 [US4] Handle password-protected archives (log error, skip) in src/services/ArchiveExtractor.ts
- [ ] T070 [US4] Handle corrupted archives (log error, move to error dir) in src/services/ArchiveExtractor.ts
- [ ] T071 [US4] Integrate ArchiveExtractor into FileProcessor pipeline in src/services/FileProcessor.ts
- [ ] T072 [US4] Process each archive entry through Parquet conversion if database file in src/services/FileProcessor.ts
- [ ] T073 [US4] Ensure original archive file NOT uploaded to S3 in src/services/FileProcessor.ts
- [ ] T074 [US4] Add logging for archive detection, extraction progress, entry count in src/services/ArchiveExtractor.ts

**Checkpoint**: All user stories should now be independently functional - complete end-to-end pipeline

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and ensure production readiness

- [ ] T075 [P] Implement concurrent file processing with configurable limit (default: 4) in src/services/FileProcessor.ts
- [ ] T076 [P] Implement memory monitoring and streaming buffer size adjustment in src/services/FileProcessor.ts
- [ ] T077 [P] Add graceful shutdown handling (finish in-progress uploads) in src/index.ts
- [ ] T078 [P] Add signal handlers (SIGTERM, SIGINT) for clean shutdown in src/index.ts
- [ ] T079 [P] Verify zero temporary files created (add assertion/monitor) in src/services/FileProcessor.ts
- [ ] T080 [P] Add comprehensive error logging with context (file path, step, error details) across all services
- [ ] T081 [P] Create integration test for basic file upload scenario in tests/integration/file-processing.test.ts
- [ ] T082 [P] Create integration test for crash recovery scenario in tests/integration/crash-recovery.test.ts
- [ ] T083 [P] Create integration test for Parquet conversion scenario in tests/integration/parquet-conversion.test.ts
- [ ] T084 [P] Create integration test for archive extraction scenario in tests/integration/archive-extraction.test.ts
- [ ] T085 [P] Add performance benchmarks (100+ files/hour throughput) in tests/integration/performance.test.ts
- [ ] T086 [P] Add large file test (10GB streaming) in tests/integration/large-files.test.ts
- [ ] T087 [P] Create README.md with setup instructions, usage examples, troubleshooting
- [ ] T088 [P] Document environment variables in README.md and .env.example
- [ ] T089 [P] Add comments to complex streaming/extraction logic
- [ ] T090 Validate against quickstart.md test scenarios (run all manual test procedures)
- [ ] T091 Code cleanup and remove any console.log statements (use logger instead)
- [ ] T092 Security audit: ensure S3 credentials not logged, validate file paths to prevent directory traversal

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User Story 1 (P1): Can start after Foundational - No dependencies on other stories
  - User Story 2 (P2): Can start after Foundational - No dependencies on other stories (adds to US1)
  - User Story 3 (P3): Can start after Foundational - Extends US1 pipeline (independent if tested standalone)
  - User Story 4 (P4): Depends on US3 completion (needs Parquet conversion for archive contents)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Completely independent
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Integrates with US1 but independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Extends US1 pipeline but independently testable
- **User Story 4 (P4)**: **Depends on User Story 3** - Needs Parquet conversion for database files inside archives

### Within Each User Story

- Models before services
- Services before integration
- Core functionality before error handling
- Logging added throughout

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (11 tasks)
- All Foundational tasks marked [P] can run in parallel (6 tasks)
- User Stories 1, 2, 3 can start in parallel after Foundational (if team capacity allows)
- User Story 4 must wait for User Story 3 completion
- All Polish tasks marked [P] can run in parallel (16 tasks)
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: Foundational Phase

```bash
# Launch all foundational tasks together:
Task: "Create TypeScript type definitions for all enums in src/types/index.ts"
Task: "Create Configuration interface and types in src/types/index.ts"
Task: "Implement Pino logger setup in src/lib/logger.ts"
Task: "Implement stream utilities in src/lib/streams.ts"
Task: "Implement SHA256 checksum calculation in src/lib/checksum.ts"
```

---

## Parallel Example: User Story 1 Models

```bash
# Launch all models for User Story 1 together:
Task: "Create FileMetadata model interface in src/models/FileMetadata.ts"
Task: "Create S3UploadTask model interface in src/models/S3UploadTask.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T011)
2. Complete Phase 2: Foundational (T012-T017) - CRITICAL
3. Complete Phase 3: User Story 1 (T018-T031)
4. **STOP and VALIDATE**: Test User Story 1 independently using quickstart.md Scenario 1.1-1.3
5. Deploy/demo if ready

**At this point you have a working MVP**: Files are automatically monitored and uploaded to S3.

### Incremental Delivery

1. **Foundation (Phases 1-2)**: Setup + Core infrastructure → ~17 tasks
2. **MVP (Phase 3)**: Add User Story 1 → Test independently → Deploy/Demo → ~14 tasks
3. **Crash Resilience (Phase 4)**: Add User Story 2 → Test independently → Deploy/Demo → ~17 tasks
4. **Parquet Conversion (Phase 5)**: Add User Story 3 → Test independently → Deploy/Demo → ~12 tasks
5. **Archive Support (Phase 6)**: Add User Story 4 → Test independently → Deploy/Demo → ~14 tasks
6. **Production Ready (Phase 7)**: Polish and testing → ~18 tasks

Each increment adds value without breaking previous stories.

### Parallel Team Strategy

With multiple developers:

1. **Together**: Complete Setup (Phase 1) + Foundational (Phase 2)
2. **Once Foundational is done**:
   - Developer A: User Story 1 (T018-T031)
   - Developer B: User Story 2 (T032-T048) - can start in parallel
   - Developer C: User Story 3 (T049-T060) - can start in parallel
3. Developer D: User Story 4 (T061-T074) - starts after Developer C finishes User Story 3
4. **All together**: Polish phase (T075-T092) in parallel

---

## Task Summary

**Total Tasks**: 92

**By Phase**:
- Phase 1 (Setup): 11 tasks
- Phase 2 (Foundational): 6 tasks
- Phase 3 (User Story 1 - MVP): 14 tasks
- Phase 4 (User Story 2): 17 tasks
- Phase 5 (User Story 3): 12 tasks
- Phase 6 (User Story 4): 14 tasks
- Phase 7 (Polish): 18 tasks

**Parallel Tasks**: 33 tasks marked [P]

**By User Story**:
- User Story 1 (P1 - MVP): 14 tasks
- User Story 2 (P2): 17 tasks
- User Story 3 (P3): 12 tasks
- User Story 4 (P4): 14 tasks
- Foundation + Setup: 17 tasks
- Polish: 18 tasks

**Critical Path** (sequential, no parallelization):
- Setup → Foundational → US1 → US2 → US3 → US4 → Polish
- Estimated: ~92 tasks sequential

**Optimized Path** (maximum parallelization):
- Setup (parallel) → Foundational (parallel) → (US1 + US2 + US3 in parallel) → US4 → Polish (parallel)
- Estimated: ~40% reduction with 3 developers

---

## Independent Test Criteria

### User Story 1 (MVP)
**Test**: Place a non-archive file in monitored directory → Verify it appears in S3 with same structure within 30 seconds
**Success**: File in S3, correct size, progress DB shows 'completed', logs show full flow

### User Story 2 (Crash Recovery)
**Test**: Upload 5 files → Kill app during 6th → Restart → Verify 1-5 skipped, 6 completed
**Success**: Resume within 30s, no re-uploads, 100% incomplete cleanup, progress DB accurate

### User Story 3 (Parquet Conversion)
**Test**: Place 100MB CSV with 1M rows → Verify only .parquet in S3, 60%+ smaller, all rows preserved
**Success**: Only Parquet in S3, size reduction met, data integrity verified

### User Story 4 (Archive Extraction)
**Test**: Place ZIP with CSV+PDF → Verify contents extracted, CSV as Parquet, PDF unchanged, no ZIP in S3
**Success**: All files extracted, structure preserved, database files converted, archive not uploaded

---

## Notes

- All tasks follow strict checklist format: `- [ ] [ID] [P?] [Story?] Description with file path`
- [P] tasks = different files, can run in parallel
- [Story] label (US1, US2, etc.) maps task to user story for traceability
- Each user story is independently testable using quickstart.md scenarios
- Verify integration tests pass before moving to next phase
- No temporary files created - verify with filesystem monitoring (FR-050, SC-011)
- Progress tracking ensures crash resilience (FR-009 through FR-019, SC-012 through SC-015)
- DuckDB handles all database-to-Parquet conversions (per research.md)
- Streaming architecture throughout for zero-disk-footprint operation
