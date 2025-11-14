# Quickstart: Data File Processor Testing Guide

**Feature**: 001-data-s3-processor
**Created**: 2025-11-15

## Overview

This guide provides test scenarios for verifying the data file processor functionality. Scenarios are organized by user story priority and designed to be independently executable.

## Prerequisites

1. **Local S3 (MinIO)** running via Docker:
   ```bash
   docker-compose up -d minio
   ```

2. **Environment configured** (`.env` file):
   ```bash
   S3_ENDPOINT=http://localhost:9000
   S3_REGION=us-east-1
   S3_BUCKET=test-bucket
   S3_ACCESS_KEY=minioadmin
   S3_SECRET_KEY=minioadmin
   WATCH_PATH=./data
   ERROR_DIRECTORY=./errors
   LOG_LEVEL=debug
   ```

3. **Test data directory**:
   ```bash
   mkdir -p data errors
   ```

4. **Application running**:
   ```bash
   npm run dev
   ```

## Test Scenarios

### User Story 1: Basic File Upload to S3 (Priority P1)

**Goal**: Verify files are monitored, detected, and uploaded to S3

#### Scenario 1.1: Upload Regular File

**Given**: Application is monitoring `./data`
**When**: Copy a PDF file to `./data/documents/report.pdf`
**Then**:
- File appears in S3 at `documents/report.pdf` within 30 seconds
- Progress DB shows status='completed' for this file
- Log shows: "File detected", "Upload started", "Upload completed"

**Test Steps**:
```bash
# 1. Prepare test file
mkdir -p data/documents
cp sample-files/report.pdf data/documents/report.pdf

# 2. Wait and verify
sleep 35

# 3. Check S3 (using AWS CLI or MinIO client)
mc ls local/test-bucket/documents/
# Expected: report.pdf with correct size

# 4. Check progress DB
sqlite3 progress.db "SELECT file_path, status FROM file_progress WHERE file_path LIKE '%report.pdf%';"
# Expected: | ./data/documents/report.pdf | completed |

# 5. Check logs
tail -50 app.log | grep report.pdf
```

**Success Criteria**:
- ✅ File in S3 within 30 seconds
- ✅ File size matches original
- ✅ Progress status is 'completed'
- ✅ Logs show complete processing flow

---

#### Scenario 1.2: Handle File Being Written

**Given**: Application is monitoring `./data`
**When**: Start copying a large file (slow write)
**Then**:
- Application waits until write completes (file size stable for 2s)
- Processing starts only after write completion
- No partial file is uploaded

**Test Steps**:
```bash
# 1. Simulate slow write with dd
dd if=/dev/zero of=data/large-file.bin bs=1M count=100 oflag=direct
# (This takes a few seconds)

# 2. Check logs immediately
tail -f app.log
# Expected: "Detected file large-file.bin, awaiting write completion..."

# 3. After write completes
# Expected: "Write complete, processing large-file.bin..."

# 4. Verify S3 upload
mc ls local/test-bucket/
```

**Success Criteria**:
- ✅ Processing waits for write completion
- ✅ Full file uploaded (100MB)
- ✅ No partial uploads detected

---

#### Scenario 1.3: Skip Already Processed Files

**Given**: File `test.txt` already uploaded and marked completed
**When**: Application restarts
**Then**:
- File is not re-uploaded
- Log shows: "Skipping test.txt (already completed)"

**Test Steps**:
```bash
# 1. Upload a file
echo "test content" > data/test.txt
sleep 10

# 2. Verify upload
mc cat local/test-bucket/test.txt

# 3. Restart application
npm run dev

# 4. Check logs
tail -50 app.log | grep test.txt
# Expected: "Skipping test.txt (already completed)"

# 5. Verify not re-uploaded
mc stat local/test-bucket/test.txt
# Check upload time hasn't changed
```

**Success Criteria**:
- ✅ File not re-uploaded
- ✅ Progress DB still shows 'completed'
- ✅ Application startup fast (<30s)

---

### User Story 2: Crash Recovery and Progress Tracking (Priority P2)

**Goal**: Verify crash resilience and progress tracking

#### Scenario 2.1: Resume After Crash

**Given**: 5 files successfully uploaded
**When**: Application crashes during 6th file upload and restarts
**Then**:
- Completed files (1-5) are skipped
- Incomplete file (6) is detected and re-uploaded
- Progress DB reflects correct state

**Test Steps**:
```bash
# 1. Upload 5 files
for i in {1..5}; do
  echo "content $i" > data/file-$i.txt
  sleep 5
done

# 2. Verify all uploaded
mc ls local/test-bucket/ | wc -l
# Expected: 5

# 3. Start uploading 6th file
echo "large content..." > data/file-6.txt

# 4. Kill application mid-upload (SIGKILL)
pkill -9 -f "node.*data-processor"

# 5. Check progress DB
sqlite3 progress.db "SELECT file_path, status FROM file_progress WHERE file_path LIKE '%file-6.txt%';"
# Expected: | ./data/file-6.txt | in_progress |

# 6. Restart application
npm run dev

# 7. Wait for recovery
sleep 30

# 8. Verify file-6 completed
mc ls local/test-bucket/file-6.txt
sqlite3 progress.db "SELECT file_path, status FROM file_progress WHERE file_path LIKE '%file-6.txt%';"
# Expected: | ./data/file-6.txt | completed |
```

**Success Criteria**:
- ✅ Files 1-5 not re-uploaded
- ✅ File-6 detected as incomplete
- ✅ File-6 successfully re-uploaded
- ✅ Recovery completes within 30 seconds

---

#### Scenario 2.2: Cleanup Incomplete S3 Uploads

**Given**: Application crashed during upload, leaving partial data in S3
**When**: Application restarts
**Then**:
- Incomplete upload detected (missing completion marker)
- Partial data deleted from S3
- File re-uploaded from beginning

**Test Steps**:
```bash
# 1. Manually create incomplete upload in S3 (simulate crash)
echo "partial" | mc pipe local/test-bucket/incomplete.txt
# (Don't set completion marker metadata)

# 2. Create progress record as 'in_progress'
sqlite3 progress.db "INSERT INTO file_progress (file_path, status, s3_key, created_at, updated_at)
VALUES ('./data/incomplete.txt', 'in_progress', 'incomplete.txt', $(date +%s), $(date +%s));"

# 3. Create local file
echo "complete content" > data/incomplete.txt

# 4. Restart application
npm run dev

# 5. Wait for cleanup and re-upload
sleep 30

# 6. Verify correct content in S3
mc cat local/test-bucket/incomplete.txt
# Expected: "complete content"

# 7. Check for completion marker
mc stat local/test-bucket/incomplete.txt --json | grep x-amz-meta-completed
```

**Success Criteria**:
- ✅ Partial upload detected
- ✅ Partial data deleted
- ✅ Complete file uploaded
- ✅ Completion marker set

---

### User Story 3: Database File Conversion to Parquet (Priority P3)

**Goal**: Verify CSV/JSON/XML converted to Parquet with compression

#### Scenario 3.1: Convert CSV to Parquet

**Given**: A 100MB CSV file with 1M rows
**When**: File placed in monitored directory
**Then**:
- CSV converted to Parquet with ZSTD compression
- Only Parquet file uploaded to S3 (no CSV)
- Parquet file is 60%+ smaller than CSV

**Test Steps**:
```bash
# 1. Generate 100MB CSV
python3 << EOF
import csv
with open('data/large-dataset.csv', 'w') as f:
    writer = csv.writer(f)
    writer.writerow(['id', 'name', 'value', 'timestamp'])
    for i in range(1000000):
        writer.writerow([i, f'user_{i}', i * 1.5, f'2025-01-{(i % 28) + 1}'])
EOF

# 2. Check file size
ls -lh data/large-dataset.csv
# Expected: ~100M

# 3. Wait for processing
sleep 60

# 4. Check S3 for Parquet file (not CSV)
mc ls local/test-bucket/
# Expected: large-dataset.parquet (NOT .csv)

# 5. Download and check size
mc cp local/test-bucket/large-dataset.parquet ./test-output/
ls -lh test-output/large-dataset.parquet
# Expected: <40M (60%+ compression)

# 6. Verify data integrity (using DuckDB or parquet-tools)
duckdb -c "SELECT COUNT(*) FROM './test-output/large-dataset.parquet';"
# Expected: 1000000
```

**Success Criteria**:
- ✅ CSV converted to Parquet
- ✅ Only .parquet in S3
- ✅ 60%+ size reduction
- ✅ All 1M rows preserved

---

#### Scenario 3.2: Mixed File Types

**Given**: Directory with CSV files and PDF files
**When**: Files placed in monitored directory
**Then**:
- CSV files converted to Parquet
- PDF files uploaded as-is
- Both present in S3 with correct formats

**Test Steps**:
```bash
# 1. Create test files
echo -e "id,name\n1,Alice\n2,Bob" > data/users.csv
cp sample-files/document.pdf data/document.pdf

# 2. Wait for processing
sleep 20

# 3. Verify S3 contents
mc ls local/test-bucket/
# Expected:
# users.parquet (CSV converted)
# document.pdf (unchanged)

# 4. Verify types
mc stat local/test-bucket/users.parquet --json | grep ContentType
# Expected: application/vnd.apache.parquet

mc stat local/test-bucket/document.pdf --json | grep ContentType
# Expected: application/pdf
```

**Success Criteria**:
- ✅ CSV → Parquet conversion
- ✅ PDF uploaded unchanged
- ✅ Correct content types

---

### User Story 4: Archive Extraction and Processing (Priority P4)

**Goal**: Verify archive extraction with database file conversion

#### Scenario 4.1: Extract ZIP Archive

**Given**: ZIP archive containing CSV and PDF files
**When**: Archive placed in monitored directory
**Then**:
- Archive extracted (not uploaded)
- CSV files converted to Parquet
- PDF files uploaded unchanged
- Directory structure preserved

**Test Steps**:
```bash
# 1. Create test archive
mkdir -p archive-source/data
echo -e "id,value\n1,100\n2,200" > archive-source/data/metrics.csv
cp sample-files/readme.pdf archive-source/readme.pdf
cd archive-source && zip -r ../data/archive.zip . && cd ..

# 2. Wait for processing
sleep 30

# 3. Verify S3 contents (no .zip file)
mc ls local/test-bucket/ --recursive
# Expected:
# data/metrics.parquet (CSV converted)
# readme.pdf (unchanged)
# NO archive.zip

# 4. Verify structure preserved
mc ls local/test-bucket/data/
# Expected: metrics.parquet

# 5. Verify original archive removed/moved
ls data/
# Expected: archive.zip moved to errors/ or deleted
```

**Success Criteria**:
- ✅ ZIP extracted
- ✅ CSV → Parquet inside archive
- ✅ PDF uploaded unchanged
- ✅ Directory structure preserved
- ✅ Original ZIP not in S3

---

#### Scenario 4.2: Nested Archive

**Given**: ZIP containing another ZIP
**When**: Archive placed in monitored directory
**Then**:
- Outer ZIP extracted
- Inner ZIP extracted
- All files processed and uploaded

**Test Steps**:
```bash
# 1. Create nested archive
mkdir -p nested/inner
echo "data" > nested/inner/data.txt
cd nested && zip inner.zip inner/data.txt && cd ..
cd nested && zip -r ../data/outer.zip inner.zip && cd ..

# 2. Wait for processing
sleep 30

# 3. Verify nested extraction
mc ls local/test-bucket/ --recursive
# Expected: inner/data.txt

# 4. Check logs for nested processing
tail -100 app.log | grep "nested archive"
```

**Success Criteria**:
- ✅ Both archives extracted
- ✅ Innermost files uploaded
- ✅ Correct nested structure

---

## Performance Testing

### Throughput Test

**Goal**: Verify 100+ files/hour processing rate

```bash
# Generate 150 small files
for i in {1..150}; do
  echo "content $i" > data/perf-test-$i.txt
done

# Measure time
START=$(date +%s)
# ... wait for all files to be uploaded ...
END=$(date +%s)

# Calculate rate
DURATION=$((END - START))
RATE=$((150 * 3600 / DURATION))
echo "Processing rate: $RATE files/hour"
# Expected: > 100 files/hour
```

### Large File Test

**Goal**: Verify 10GB file processing via streaming

```bash
# Create 10GB file
dd if=/dev/zero of=data/huge.bin bs=1M count=10240

# Monitor memory usage during processing
watch -n 1 'ps aux | grep data-processor | grep -v grep'
# Expected: Memory usage <1GB (streaming, not loading into memory)

# Wait for upload
# ...

# Verify uploaded
mc stat local/test-bucket/huge.bin
# Expected: 10GB file size
```

---

## Troubleshooting

### Check Progress Database

```bash
sqlite3 progress.db "SELECT file_path, status, updated_at FROM file_progress ORDER BY updated_at DESC LIMIT 10;"
```

### Check S3 Objects

```bash
mc ls local/test-bucket/ --recursive
```

### Check Application Logs

```bash
tail -f app.log | jq '.' # Pretty-print JSON logs
```

### Reset Test Environment

```bash
# Stop application
pkill -f "node.*data-processor"

# Clear test data
rm -rf data/* data/errors/*

# Clear progress DB
rm progress.db

# Clear S3 bucket
mc rm local/test-bucket/ --recursive --force

# Restart
npm run dev
```

---

## Success Criteria Summary

| User Story | Key Verification | Expected Result |
|------------|------------------|-----------------|
| US1 (P1) | File upload | File in S3 within 30s |
| US1 (P1) | Write detection | Waits for write completion |
| US1 (P1) | Skip processed | No re-upload on restart |
| US2 (P2) | Crash recovery | Resume within 30s |
| US2 (P2) | Incomplete cleanup | 100% cleanup rate |
| US3 (P3) | CSV to Parquet | 60%+ compression |
| US3 (P3) | Mixed types | Correct conversion per type |
| US4 (P4) | ZIP extraction | Contents uploaded, not ZIP |
| US4 (P4) | Nested archives | Full nested extraction |

---

## CI/CD Integration

These scenarios should be automated in CI/CD:

```yaml
# Example GitHub Actions workflow
test:
  runs-on: ubuntu-latest
  steps:
    - name: Start MinIO
      run: docker-compose up -d minio

    - name: Run integration tests
      run: npm run test:integration

    - name: Verify test coverage
      run: npm run coverage:check
```

**Minimum coverage targets**:
- Unit tests: 80% coverage
- Integration tests: All user stories covered
- Performance tests: Throughput + large file scenarios
