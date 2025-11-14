# Quick Start: End-to-End Docker S3 Persistence Test

**Feature**: 002-s3-persistence-e2e
**Date**: 2025-11-15
**Version**: 1.0.0

## Overview

This guide explains how to run the comprehensive end-to-end integration test suite that validates Docker-based S3 file processing, state persistence, and script restart capabilities.

## Prerequisites

### Required Software

1. **Docker Desktop** or **Docker Engine** (version 20.10+)
   - Verify installation: `docker --version`
   - Docker daemon must be running

2. **Node.js** (version 20+)
   - Verify installation: `node --version`

3. **npm** (version 9+)
   - Verify installation: `npm --version`

### System Requirements

- **Operating System**: Linux, macOS, or Windows with WSL2
- **Disk Space**: Minimum 1GB free space for test data
- **RAM**: Minimum 2GB available
- **Network**: Ports 9002 and 9003 must be available (test S3 endpoints)

### Check Availability

Run the prerequisite check:

```bash
# Check Docker
docker ps

# Check ports
lsof -i :9002  # Should return nothing (port free)
lsof -i :9003  # Should return nothing (port free)

# Check disk space
df -h /tmp     # Should show >1GB available
```

## Installation

### 1. Clone and Install Dependencies

```bash
# Navigate to project root
cd db-leak-explorer

# Install dependencies (if not already done)
npm install

# Build the project
npm run build
```

### 2. Verify Test Configuration

The E2E tests use a dedicated Docker Compose configuration:

```bash
# Verify test Docker Compose exists
cat docker/test/docker-compose.test.yml
```

This should show MinIO configuration on ports 9002/9003 (different from dev ports 9000/9001).

## Running Tests

### Quick Run (All Tests)

Run the full E2E test suite:

```bash
npm run test:e2e
```

**Expected Output**:
```
 PASS  tests/e2e/setup/docker-environment.test.ts (35.2s)
 PASS  tests/e2e/scenarios/file-tracking-migration.test.ts (45.1s)
 PASS  tests/e2e/scenarios/script-restart-resume.test.ts (78.5s)
 PASS  tests/e2e/scenarios/state-validation.test.ts (12.3s)

Test Suites: 4 passed, 4 total
Tests:       24 passed, 24 total
Snapshots:   0 total
Time:        171.1s
Ran all test suites matching /e2e/i.
```

**Duration**: ~3-5 minutes total

### Run Specific Test Suites

Run only P1 (environment setup) tests:

```bash
npm test -- tests/e2e/setup/docker-environment.test.ts
```

Run only P2 (file tracking) tests:

```bash
npm test -- tests/e2e/scenarios/file-tracking-migration.test.ts
```

Run only P3 (restart/resume) tests:

```bash
npm test -- tests/e2e/scenarios/script-restart-resume.test.ts
```

Run only P4 (state validation) tests:

```bash
npm test -- tests/e2e/scenarios/state-validation.test.ts
```

### Watch Mode (Development)

Run tests in watch mode (re-runs on file changes):

```bash
npm test -- --watch tests/e2e
```

### Debug Mode

Run with verbose logging:

```bash
DEBUG=* npm run test:e2e
```

Run with Jest debug output:

```bash
npm test -- --verbose tests/e2e
```

## Test Structure

### Test Organization

```
tests/e2e/
├── setup/
│   ├── docker-environment.test.ts      # P1: Environment setup tests
│   ├── mock-data-generator.ts          # Helper: generates test files
│   └── test-fixtures.ts                # Helper: fixture definitions
├── scenarios/
│   ├── file-tracking-migration.test.ts # P2: Processing pipeline tests
│   ├── script-restart-resume.test.ts   # P3: Restart/resume tests
│   └── state-validation.test.ts        # P4: State management tests
└── helpers/
    ├── docker-manager.ts               # Helper: Docker lifecycle
    ├── s3-test-client.ts               # Helper: S3 operations
    └── process-controller.ts           # Helper: Script control
```

### Test Lifecycle

1. **Global Setup** (`tests/setup.ts`)
   - Starts Docker Compose (MinIO S3 on ports 9002/9003)
   - Waits for health check to pass
   - Creates test bucket

2. **Before Each Test Suite** (`beforeAll`)
   - Creates unique test data directory
   - Generates mock files (12 files: archives + regular + edge cases)
   - Initializes S3 client and database connection

3. **After Each Test** (`afterEach`)
   - Cleans up test-specific data
   - Removes S3 objects
   - Deletes temp files
   - Clears database records

4. **Global Teardown** (`tests/teardown.ts`)
   - Stops Docker containers
   - Removes Docker volumes
   - Cleans up any remaining test artifacts

## Understanding Test Results

### Success Indicators

✅ **All tests pass**: Green checkmarks for all test suites

✅ **Performance met**: Total duration < 5 minutes

✅ **Cleanup complete**: No leftover containers, files, or buckets

### Test Output Interpretation

```
 PASS  tests/e2e/setup/docker-environment.test.ts
  P1: Docker Test Environment Setup
    ✓ Docker container starts successfully (2345 ms)
    ✓ S3 endpoint is accessible (156 ms)
    ✓ Test bucket created (234 ms)
    ✓ Test data directory exists with 12 mock files (567 ms)
    ✓ Source directory created (45 ms)
```

Each ✓ represents a successful assertion defined in [contracts/test-expectations.yaml](./contracts/test-expectations.yaml).

### Common Test Failures

#### Docker Not Running

```
Error: Docker daemon not available
```

**Solution**: Start Docker Desktop or Docker daemon:
```bash
# macOS/Linux
sudo systemctl start docker

# macOS (Docker Desktop)
open /Applications/Docker.app
```

#### Port Already in Use

```
Error: Port 9002 or 9003 already in use
```

**Solution**: Find and stop the process using the port:
```bash
# Find process on port 9002
lsof -i :9002

# Kill the process (replace PID with actual process ID)
kill -9 <PID>
```

#### Insufficient Disk Space

```
Error: Not enough disk space
```

**Solution**: Free up space or change test data directory:
```bash
# Check disk space
df -h /tmp

# Clean Docker volumes
docker system prune -a --volumes
```

#### S3 Connection Timeout

```
Error: S3 endpoint not responding
```

**Solution**: Check Docker container health:
```bash
# Check MinIO container status
docker ps | grep minio-test

# Check MinIO logs
docker logs data-processor-minio-test

# Restart test environment
npm run test:e2e:reset
```

## Advanced Usage

### Running Individual Tests

Run a specific test by name:

```bash
npm test -- --testNamePattern="Docker container starts successfully"
```

### Updating Test Expectations

Test expectations are defined in [contracts/test-expectations.yaml](./contracts/test-expectations.yaml).

To modify expected outcomes:

1. Edit `contracts/test-expectations.yaml`
2. Update relevant assertion values
3. Re-run tests to verify

Example: Change expected file count from 12 to 15:

```yaml
# contracts/test-expectations.yaml
mock_data:
  total_files: 15  # Changed from 12
```

### Custom Test Data

To generate custom mock data:

1. Edit `tests/e2e/setup/mock-data-generator.ts`
2. Modify `generateMockFiles()` function
3. Update test expectations in `contracts/test-expectations.yaml`
4. Re-run tests

### Environment Variables

Override test configuration with environment variables:

```bash
# Use different S3 port
E2E_S3_PORT=9010 npm run test:e2e

# Use different test data directory
E2E_TEST_DIR=/custom/path npm run test:e2e

# Increase timeout
E2E_TIMEOUT=600000 npm run test:e2e
```

## Troubleshooting

### View Test Logs

Test logs are written to console. For persistent logs:

```bash
npm run test:e2e 2>&1 | tee test-output.log
```

### Inspect Test Database

After a test run, inspect the SQLite database:

```bash
# Find test database (look for /tmp/e2e-test-*/state.db)
ls -la /tmp/e2e-test-*/state.db

# Open with sqlite3
sqlite3 /tmp/e2e-test-<timestamp>/state.db

# Query processing jobs
sqlite> SELECT * FROM processing_jobs;

# Query progress records
sqlite> SELECT * FROM progress_records;
```

### Inspect S3 Test Data

View S3 objects in test bucket:

```bash
# Install AWS CLI or use MinIO client
brew install minio/stable/mc

# Configure MinIO client
mc alias set test-minio http://localhost:9002 minioadmin minioadmin

# List buckets
mc ls test-minio

# List objects in test bucket
mc ls test-minio/test-bucket-<timestamp>

# Download object for inspection
mc cp test-minio/test-bucket-<timestamp>/data.parquet ./
```

### Manual Cleanup

If tests fail to clean up:

```bash
# Stop all test containers
docker-compose -f docker/test/docker-compose.test.yml down -v

# Remove test data directories
rm -rf /tmp/e2e-test-*

# Remove dangling Docker volumes
docker volume prune -f
```

### Reset Test Environment

Complete reset:

```bash
# Stop containers and clean up
npm run test:e2e:reset

# Or manually:
docker-compose -f docker/test/docker-compose.test.yml down -v
rm -rf /tmp/e2e-test-*
docker system prune -f
```

## Performance Benchmarks

Expected performance on standard hardware (4-core CPU, 8GB RAM, SSD):

| Test Suite | Duration | Files Processed | S3 Uploads |
|------------|----------|-----------------|------------|
| P1: Environment Setup | ~30s | 0 | 0 |
| P2: File Tracking | ~45s | 12 | 10 |
| P3: Restart/Resume | ~80s | 12 | 10 |
| P4: State Validation | ~15s | 0 | 0 |
| **Total** | **~170s** | **12** | **10** |

**Success Criteria** (from [spec.md](./spec.md)):
- ✅ Total duration < 5 minutes (300s)
- ✅ Environment setup < 30s
- ✅ 100% file upload success rate
- ✅ 0% file reprocessing after restart
- ✅ 100% test assertion accuracy

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build project
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: test-output.log
```

### GitLab CI Example

```yaml
# .gitlab-ci.yml
e2e-tests:
  image: node:20
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2375
  script:
    - npm ci
    - npm run build
    - npm run test:e2e
  artifacts:
    when: always
    reports:
      junit: junit.xml
```

## Next Steps

After running E2E tests successfully:

1. **Review test results**: Check [contracts/test-expectations.yaml](./contracts/test-expectations.yaml) for detailed assertions
2. **Explore data model**: See [data-model.md](./data-model.md) for test data structures
3. **Review implementation plan**: See [plan.md](./plan.md) for technical details
4. **Generate tasks**: Run `/speckit.tasks` to create implementation checklist

## Support

For issues or questions:

1. Check [research.md](./research.md) for design decisions and alternatives
2. Review [spec.md](./spec.md) for requirements and success criteria
3. Inspect test expectations in [contracts/test-expectations.yaml](./contracts/test-expectations.yaml)
4. Check existing test output for error messages

## References

- Feature Specification: [spec.md](./spec.md)
- Implementation Plan: [plan.md](./plan.md)
- Research Findings: [research.md](./research.md)
- Data Model: [data-model.md](./data-model.md)
- Test Contract: [contracts/test-expectations.yaml](./contracts/test-expectations.yaml)
