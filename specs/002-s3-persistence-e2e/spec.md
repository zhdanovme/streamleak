# Feature Specification: End-to-End Docker S3 Persistence Test

**Feature Branch**: `002-s3-persistence-e2e`
**Created**: 2025-11-15
**Status**: Draft
**Input**: User description: "create test, that launches docker container with s3, /test-data folder with some mock files (acrives and not) and folder from where the movement happens, and script that tracks all files, moves some files to s3 as parquet, then the script closes, opens again and ensures in the end that mork was continued, and on failed/done tests files from inital test folder, so tries to test main behaviour end-to-end"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Docker Test Environment Setup (Priority: P1)

As a developer, I need an automated test that sets up a complete isolated environment with Docker-based S3 storage and test data, so that I can validate the system's file processing capabilities without requiring external services.

**Why this priority**: This is foundational - without a proper test environment, no other testing can occur. It provides the infrastructure needed for all subsequent test scenarios.

**Independent Test**: Can be fully tested by verifying that Docker container starts successfully, S3 service is accessible, and test data folders are created with appropriate mock files. Delivers a validated, reproducible test environment.

**Acceptance Scenarios**:

1. **Given** no existing test containers are running, **When** the test starts, **Then** a Docker container with S3 service is launched and ready to accept connections
2. **Given** the Docker container is running, **When** test initialization completes, **Then** a /test-data folder exists with at least 10 mock files including both archive formats (.tar, .gz, .zip) and regular files
3. **Given** test data is created, **When** verification runs, **Then** a source folder exists from which files will be processed and moved to S3

---

### User Story 2 - File Tracking and Migration Validation (Priority: P2)

As a developer, I need the test to track all files before processing and validate successful migration to S3 in parquet format, so that I can ensure the core file processing and conversion logic works correctly.

**Why this priority**: This validates the primary business logic of the system - file tracking and S3 migration. Without this working, the application has no value.

**Independent Test**: Can be tested independently by running the script once, verifying file inventory is captured, files are converted to parquet, and uploaded to S3. Delivers confidence in core processing logic.

**Acceptance Scenarios**:

1. **Given** test data folder contains multiple files, **When** the script starts, **Then** all files are inventoried and tracked with their initial states
2. **Given** files are tracked, **When** processing begins, **Then** selected files are converted to parquet format
3. **Given** files are converted, **When** upload completes, **Then** parquet files exist in the S3 bucket with correct structure
4. **Given** files are moved to S3, **When** verification runs, **Then** file count in S3 matches expected migration count

---

### User Story 3 - Script Restart and State Persistence (Priority: P3)

As a developer, I need the test to verify that work continues correctly after script interruption and restart, so that I can ensure the system handles failures gracefully and doesn't lose track of processing state.

**Why this priority**: This validates critical resilience behavior. While not needed for basic functionality, it's essential for production reliability.

**Independent Test**: Can be tested by interrupting the script mid-processing, restarting it, and verifying that previously processed files aren't reprocessed and remaining files are completed. Delivers confidence in state management.

**Acceptance Scenarios**:

1. **Given** the script is processing files, **When** the script is stopped mid-processing, **Then** current processing state is persisted to disk
2. **Given** the script was stopped, **When** the script restarts, **Then** it resumes from the last known state without reprocessing completed files
3. **Given** the script resumed, **When** all processing completes, **Then** the final state matches what would have occurred in a single uninterrupted run

---

### User Story 4 - Failed and Completed File Validation (Priority: P4)

As a developer, I need the test to validate that files in different states (failed, done) are correctly tracked in the initial test folder, so that I can ensure proper state management and error handling.

**Why this priority**: This validates edge cases and error handling. Important for completeness but not required for basic happy-path functionality.

**Independent Test**: Can be tested by examining files in the test folder after processing, verifying state markers or logs indicate which files succeeded, failed, or are pending. Delivers confidence in comprehensive state tracking.

**Acceptance Scenarios**:

1. **Given** processing completed, **When** test folder is inspected, **Then** files are categorized by their final state (done, failed, pending)
2. **Given** some files failed processing, **When** verification runs, **Then** failed files are identified and logged with reasons
3. **Given** all files processed, **When** final validation runs, **Then** the count of done + failed + pending files equals total initial file count

---

### Edge Cases

- What happens when Docker container fails to start or S3 service is unavailable?
- What happens when a file is corrupted and cannot be converted to parquet?
- What happens if the script is killed forcefully (SIGKILL) instead of gracefully stopped?
- What happens when S3 storage is full or upload fails partway through?
- What happens if state persistence file is corrupted when the script restarts?
- What happens when mock files have duplicate names or special characters?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Test MUST launch a Docker container with S3-compatible storage service
- **FR-002**: Test MUST create a /test-data folder containing at least 10 mock files with variety (archives: .tar, .gz, .zip, .tar.gz and regular files: .csv, .json, .txt, .sql)
- **FR-003**: Test MUST create a source folder from which files will be moved during processing
- **FR-004**: Test MUST inventory and track all files before processing begins, capturing file names, sizes, and types
- **FR-005**: Test MUST process and convert files to parquet format
- **FR-006**: Test MUST upload converted parquet files to the S3 bucket
- **FR-007**: Test MUST support graceful script shutdown during processing
- **FR-008**: Test MUST persist processing state to allow continuation after restart
- **FR-009**: Test MUST verify state persistence by stopping the script mid-processing and restarting it
- **FR-010**: Test MUST verify that restarted script continues from last checkpoint without reprocessing completed files
- **FR-011**: Test MUST categorize files by final state: done (successfully processed), failed (processing errors), pending (not yet processed)
- **FR-012**: Test MUST validate that initial test folder reflects accurate file states after processing
- **FR-013**: Test MUST verify end-to-end behavior by comparing initial file inventory with final S3 contents and state logs
- **FR-014**: Test MUST clean up Docker containers and test data after completion or failure

### Key Entities

- **Mock File**: Represents test data files with attributes including name, type (archive or regular), format (.tar, .csv, etc.), size, and initial state
- **Processing State**: Tracks the status of each file (pending, in-progress, done, failed) with timestamps and error messages if applicable
- **S3 Parquet Object**: Represents the converted file stored in S3, containing original file metadata and parquet-formatted data
- **Test Environment**: Encompasses the Docker container, S3 service configuration, test-data folder, and source folder

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Test completes full execution (setup, processing, restart, validation, cleanup) in under 5 minutes
- **SC-002**: 100% of successfully converted files appear in S3 in parquet format
- **SC-003**: After script restart, 0% of previously completed files are reprocessed
- **SC-004**: Test correctly identifies and logs at least 90% of intentionally failed file conversions
- **SC-005**: Test environment (Docker container, folders, mock files) is successfully created in under 30 seconds
- **SC-006**: State persistence mechanism accurately tracks file processing status with less than 1% error rate
- **SC-007**: Test validation phase correctly verifies end-to-end behavior with 100% accuracy (all assertions pass)
- **SC-008**: Test cleanup successfully removes all Docker containers and test data with no leftover artifacts

## Assumptions

- Docker is installed and available on the test environment
- The system has sufficient disk space for test data and parquet conversions (minimum 1GB)
- S3-compatible service (such as LocalStack or MinIO) can be run in Docker
- Archive files (.tar, .gz, .zip) are valid and can be extracted or processed
- File conversion to parquet is handled by existing system logic (not part of test implementation)
- Script shutdown can be triggered programmatically (e.g., process signal or API call)
- State persistence uses file-based storage (JSON, SQLite, or similar) accessible after restart
- Test runs in an automated CI/CD environment or local development environment
- Failed files are those that encounter errors during conversion or upload, not files that are skipped by design

## Out of Scope

- Performance testing under high load or large file volumes
- Security testing of S3 authentication or encryption
- Testing of file format variations beyond specified types (.tar, .gz, .zip, .csv, .json, .txt, .sql)
- Network failure simulation or retry logic testing
- Multi-instance parallel processing testing
- Production deployment configuration
