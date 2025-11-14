# Data Model: End-to-End Docker S3 Persistence Test

**Feature**: 002-s3-persistence-e2e
**Date**: 2025-11-15
**Status**: Complete

## Overview

This document defines the data structures used in E2E tests to validate file processing, state persistence, and script restart capabilities. The test data model leverages existing production models (`FileMetadata`, `ProcessingJob`, `ProgressRecord`, `S3UploadTask`) while adding test-specific structures for validation and assertions.

## Test Data Structures

### 1. MockFile (Test Fixture)

Represents a test file created by the mock data generator for E2E validation.

**Purpose**: Define expected test files with known properties for validation

**Attributes**:
- `fileName`: String - Name of the file (e.g., "data.csv", "archive.tar")
- `fileType`: Enum - `'archive' | 'regular'`
- `format`: String - File extension (e.g., ".csv", ".tar", ".gz")
- `size`: Number - File size in bytes
- `contentHash`: String - SHA256 hash of file content (for validation)
- `shouldFail`: Boolean - Whether this file is expected to fail processing (for edge case testing)
- `failureReason`: String | null - Expected failure reason (e.g., "corrupted_archive", "invalid_format")

**Validation Rules**:
- `fileName` must be unique within a test suite
- `format` must match one of: `.tar`, `.gz`, `.zip`, `.tar.gz`, `.csv`, `.json`, `.txt`, `.sql`
- If `shouldFail` is true, `failureReason` must be non-null
- `contentHash` must be SHA256 (64 hex characters)

**Relationships**:
- One-to-one with production `FileMetadata` (after file is scanned)
- One-to-many with test assertions (each mock file has multiple validation points)

**Example**:
```typescript
interface MockFile {
  fileName: string;
  fileType: 'archive' | 'regular';
  format: string;
  size: number;
  contentHash: string;
  shouldFail: boolean;
  failureReason: string | null;
}

// Example instance
const mockCSVFile: MockFile = {
  fileName: 'data.csv',
  fileType: 'regular',
  format: '.csv',
  size: 1024,
  contentHash: 'a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1',
  shouldFail: false,
  failureReason: null
};
```

---

### 2. TestEnvironmentConfig (Test Setup)

Defines the configuration for a test run, including Docker, S3, and file system settings.

**Purpose**: Centralize test environment configuration for reproducibility and isolation

**Attributes**:
- `testId`: String - Unique identifier for this test run (timestamp-based)
- `dockerComposePath`: String - Path to test Docker Compose file
- `s3Endpoint`: String - MinIO endpoint (e.g., "http://localhost:9002")
- `s3AccessKey`: String - Test S3 access key
- `s3SecretKey`: String - Test S3 secret key
- `s3BucketName`: String - Unique test bucket name (e.g., `test-bucket-${testId}`)
- `testDataDir`: String - Path to temp directory for test files
- `stateDbPath`: String - Path to test SQLite database
- `sourceDir`: String - Directory from which files are processed
- `timeout`: Number - Test suite timeout in milliseconds

**Validation Rules**:
- `testId` must be unique (use `Date.now()` or UUID)
- `s3Endpoint` must be a valid URL
- All directory paths must be absolute paths
- `timeout` must be between 60000ms (1 min) and 600000ms (10 min)

**Relationships**:
- One-to-many with `MockFile` (environment contains multiple test files)
- One-to-one with test suite execution

**Example**:
```typescript
interface TestEnvironmentConfig {
  testId: string;
  dockerComposePath: string;
  s3Endpoint: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3BucketName: string;
  testDataDir: string;
  stateDbPath: string;
  sourceDir: string;
  timeout: number;
}

// Example instance
const testConfig: TestEnvironmentConfig = {
  testId: `test-${Date.now()}`,
  dockerComposePath: './docker/test/docker-compose.test.yml',
  s3Endpoint: 'http://localhost:9002',
  s3AccessKey: 'minioadmin',
  s3SecretKey: 'minioadmin',
  s3BucketName: `test-bucket-${Date.now()}`,
  testDataDir: `/tmp/e2e-test-${Date.now()}`,
  stateDbPath: `/tmp/e2e-test-${Date.now()}/state.db`,
  sourceDir: `/tmp/e2e-test-${Date.now()}/source`,
  timeout: 300000 // 5 minutes
};
```

---

### 3. TestAssertion (Validation)

Represents an expected outcome that must be verified during or after test execution.

**Purpose**: Define testable expectations for E2E validation

**Attributes**:
- `assertionId`: String - Unique identifier for this assertion
- `description`: String - Human-readable description of what's being tested
- `targetFile`: String - File name this assertion applies to (or '*' for all files)
- `checkType`: Enum - Type of validation (see below)
- `expectedValue`: any - Expected outcome (type depends on checkType)
- `actualValue`: any | null - Actual outcome (populated during test execution)
- `status`: Enum - `'pending' | 'passed' | 'failed'`
- `errorMessage`: String | null - Failure reason if status is 'failed'

**Check Types**:
- `'file_exists'`: File exists in S3 (expectedValue: boolean)
- `'file_count'`: Number of files in state (expectedValue: number)
- `'state_matches'`: Processing state matches (expectedValue: 'pending' | 'done' | 'failed')
- `'no_reprocessing'`: File not processed twice (expectedValue: true)
- `'parquet_valid'`: S3 object is valid parquet (expectedValue: true)
- `'content_hash'`: Content hash matches (expectedValue: string)

**Validation Rules**:
- `assertionId` must be unique within a test suite
- `checkType` must be one of the defined enum values
- `expectedValue` type must match `checkType` requirements
- If `status` is 'failed', `errorMessage` must be non-null

**Relationships**:
- Many-to-one with `MockFile` (multiple assertions per file)
- Many-to-one with `TestSuiteResult` (suite contains all assertions)

**State Transitions**:
```
pending → passed (when assertion succeeds)
pending → failed (when assertion fails)
```

**Example**:
```typescript
interface TestAssertion {
  assertionId: string;
  description: string;
  targetFile: string;
  checkType: 'file_exists' | 'file_count' | 'state_matches' | 'no_reprocessing' | 'parquet_valid' | 'content_hash';
  expectedValue: any;
  actualValue: any | null;
  status: 'pending' | 'passed' | 'failed';
  errorMessage: string | null;
}

// Example instance
const assertion: TestAssertion = {
  assertionId: 'assert-001',
  description: 'Verify data.csv uploaded to S3 as parquet',
  targetFile: 'data.csv',
  checkType: 'file_exists',
  expectedValue: true,
  actualValue: null, // Populated during test
  status: 'pending',
  errorMessage: null
};
```

---

### 4. TestSuiteResult (Execution Summary)

Aggregates all test results for reporting and validation.

**Purpose**: Provide comprehensive test execution summary

**Attributes**:
- `suiteId`: String - Unique identifier for this test suite run
- `startTime`: Date - Test suite start timestamp
- `endTime`: Date | null - Test suite end timestamp
- `duration`: Number | null - Execution time in milliseconds
- `totalFiles`: Number - Total number of mock files
- `filesProcessed`: Number - Number of files successfully processed
- `filesFailed`: Number - Number of files that failed processing
- `filesPending`: Number - Number of files not yet processed
- `assertions`: TestAssertion[] - All test assertions
- `assertionsPassed`: Number - Count of passed assertions
- `assertionsFailed`: Number - Count of failed assertions
- `dockerStatus`: Enum - `'started' | 'healthy' | 'stopped' | 'error'`
- `cleanupComplete`: Boolean - Whether cleanup was successful
- `overallStatus`: Enum - `'passed' | 'failed' | 'error'`

**Validation Rules**:
- `totalFiles` must equal `filesProcessed + filesFailed + filesPending`
- `assertions.length` must equal `assertionsPassed + assertionsFailed + assertionsPending`
- If `endTime` is set, `duration` must equal `endTime - startTime`
- `overallStatus` is 'passed' only if all assertions passed and cleanup succeeded

**Relationships**:
- One-to-many with `TestAssertion` (suite contains all assertions)
- One-to-many with `MockFile` (suite processes all mock files)
- One-to-one with `TestEnvironmentConfig` (suite uses one config)

**Example**:
```typescript
interface TestSuiteResult {
  suiteId: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  totalFiles: number;
  filesProcessed: number;
  filesFailed: number;
  filesPending: number;
  assertions: TestAssertion[];
  assertionsPassed: number;
  assertionsFailed: number;
  dockerStatus: 'started' | 'healthy' | 'stopped' | 'error';
  cleanupComplete: boolean;
  overallStatus: 'passed' | 'failed' | 'error';
}

// Example instance
const suiteResult: TestSuiteResult = {
  suiteId: 'suite-001',
  startTime: new Date(),
  endTime: null,
  duration: null,
  totalFiles: 10,
  filesProcessed: 0,
  filesFailed: 0,
  filesPending: 10,
  assertions: [],
  assertionsPassed: 0,
  assertionsFailed: 0,
  dockerStatus: 'started',
  cleanupComplete: false,
  overallStatus: 'passed' // Updated at end
};
```

---

## Integration with Existing Models

The E2E tests validate existing production models defined in `src/models/`:

### FileMetadata (Existing - Production Model)
- **Test Usage**: Verified that mock files are correctly scanned and metadata captured
- **Test Assertions**: File name, size, type, checksum match expected values
- **Relationship**: Each `MockFile` should produce one `FileMetadata` record

### ProcessingJob (Existing - Production Model)
- **Test Usage**: Verified that jobs are created for each file and status transitions correctly
- **Test Assertions**: Job status moves from 'pending' → 'processing' → 'done' or 'failed'
- **Relationship**: Each `MockFile` should produce one `ProcessingJob` record

### ProgressRecord (Existing - Production Model)
- **Test Usage**: Verified that progress is tracked and resumes correctly after restart
- **Test Assertions**: Records persist across script restarts, no duplicate processing
- **Relationship**: Each file processing event creates a `ProgressRecord` entry

### S3UploadTask (Existing - Production Model)
- **Test Usage**: Verified that S3 uploads are tracked and successful
- **Test Assertions**: Upload status, S3 key, bucket name, content type match expected
- **Relationship**: Each successful conversion creates one `S3UploadTask` record

---

## Data Flow Diagram

```
Test Suite Start
    ↓
TestEnvironmentConfig created
    ↓
Mock Files Generated (MockFile[])
    ↓
Docker Environment Started (docker-compose up)
    ↓
Application Script Started
    ↓
Files Scanned → FileMetadata created (1:1 with MockFile)
    ↓
Processing Jobs Created → ProcessingJob created (1:1 with FileMetadata)
    ↓
Files Processed → ProgressRecord created (many per file)
    ↓
Uploads to S3 → S3UploadTask created (1:1 with successful processing)
    ↓
Test Assertions Executed (TestAssertion validated)
    ↓
Script Stopped/Restarted (if testing restart scenario)
    ↓
Resume from State (ProgressRecord validated)
    ↓
Final Assertions (all TestAssertion checked)
    ↓
TestSuiteResult Generated
    ↓
Cleanup (Docker down, temp files removed)
    ↓
Test Suite End
```

---

## Database Schema (Test State)

The tests use a temporary SQLite database with the same schema as production:

```sql
-- From existing application (src/models/)

CREATE TABLE IF NOT EXISTS file_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (file_id) REFERENCES file_metadata(id)
);

CREATE TABLE IF NOT EXISTS progress_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  processed_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
);

CREATE TABLE IF NOT EXISTS s3_upload_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'uploading', 'done', 'failed')),
  uploaded_at TEXT,
  FOREIGN KEY (job_id) REFERENCES processing_jobs(id)
);
```

**Test Validation**: Tests query these tables to verify:
- Correct number of records created
- Status transitions happen as expected
- No duplicate processing after restart
- Foreign key relationships maintained

---

## Mock Data Specification

### Regular Files (7 files)

| File Name | Format | Size (approx) | Content Description |
|-----------|--------|---------------|---------------------|
| data.csv | .csv | 1KB | CSV with 3 columns, 100 rows |
| config.json | .json | 512B | JSON config object |
| logs.txt | .txt | 2KB | Plain text log entries |
| metrics.csv | .csv | 4KB | CSV with metrics data |
| settings.json | .json | 256B | JSON settings |
| readme.txt | .txt | 1KB | Plain text documentation |
| schema.sql | .sql | 2KB | SQL schema with CREATE TABLE statements |

### Archive Files (4 files)

| File Name | Format | Size (approx) | Content Description |
|-----------|--------|---------------|---------------------|
| archive1.tar | .tar | 5KB | TAR with 3 text files inside |
| archive2.gz | .gz | 3KB | GZIP compressed text file |
| archive3.zip | .zip | 4KB | ZIP with 2 CSV files inside |
| archive4.tar.gz | .tar.gz | 6KB | GZIP'd TAR with 5 files inside |

### Edge Case Files (2 files)

| File Name | Format | Size | Content Description | Expected Outcome |
|-----------|--------|------|---------------------|------------------|
| corrupted.tar | .tar | 512B | Invalid TAR header | Should fail processing |
| special-chars_【file】.txt | .txt | 256B | File with special characters | Should process successfully |

**Total**: 13 files (10+ requirement met)

---

## Validation Checklist

For each test, the following validations are performed:

**Setup Validation** (P1):
- [ ] Docker container started successfully
- [ ] S3 endpoint accessible (health check passes)
- [ ] Test bucket created
- [ ] Test data directory exists
- [ ] Mock files generated (13 files)
- [ ] Source directory created

**Processing Validation** (P2):
- [ ] All files scanned (13 `FileMetadata` records)
- [ ] All jobs created (13 `ProcessingJob` records)
- [ ] Files converted to parquet (11 successful, 2 failed)
- [ ] Parquet files uploaded to S3 (11 objects in bucket)
- [ ] S3 upload tasks tracked (11 `S3UploadTask` records)

**Restart Validation** (P3):
- [ ] State persisted before shutdown (database has progress records)
- [ ] Script resumes without errors
- [ ] No files reprocessed (progress records unchanged for completed files)
- [ ] Remaining files processed (pending files completed)
- [ ] Final state matches expected (all files done or failed)

**State Validation** (P4):
- [ ] Done files correctly marked (11 files)
- [ ] Failed files correctly marked (2 files with error messages)
- [ ] No pending files remain
- [ ] Total count matches initial files (11 done + 2 failed = 13 total)

---

## Next Steps

Proceed to create:
1. **contracts/test-expectations.yaml** - Define expected test outcomes in machine-readable format
2. **quickstart.md** - Instructions for running the E2E tests
