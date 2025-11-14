# Research: End-to-End Docker S3 Persistence Test

**Feature**: 002-s3-persistence-e2e
**Date**: 2025-11-15
**Status**: Complete

## Overview

This document consolidates research findings for implementing a comprehensive E2E test suite that validates Docker-based S3 file processing with state persistence and script restart capabilities.

## Research Areas

### 1. Docker Management in Jest Tests

**Decision**: Use Docker Compose with programmatic control via `docker-compose` CLI

**Rationale**:
- The project already has `docker-compose.yml` for MinIO, making this approach consistent
- `testcontainers-node` adds significant overhead (600MB+ package) and complexity
- Docker Compose provides declarative infrastructure-as-code that's easier to maintain
- Jest global setup/teardown hooks can manage Docker Compose lifecycle
- Allows reuse of existing MinIO configuration with test-specific overrides

**Alternatives Considered**:
1. **testcontainers-node**: Rejected due to package size, complexity, and redundancy with existing Docker Compose setup
2. **dockerode**: Rejected as it requires imperative container management; Docker Compose is more declarative
3. **Manual docker CLI**: Considered but Docker Compose provides better orchestration and health checks

**Implementation Approach**:
```typescript
// tests/setup.ts (Jest global setup)
import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('Starting Docker test environment...');
  execSync('docker-compose -f docker/test/docker-compose.test.yml up -d', {
    stdio: 'inherit'
  });

  // Wait for health check
  await waitForHealthy('http://localhost:9000/minio/health/live', 30000);
}

// tests/teardown.ts (Jest global teardown)
export default async function globalTeardown() {
  console.log('Stopping Docker test environment...');
  execSync('docker-compose -f docker/test/docker-compose.test.yml down -v', {
    stdio: 'inherit'
  });
}
```

**References**:
- Jest global setup/teardown: https://jestjs.io/docs/configuration#globalsetup-string
- Docker Compose CLI: https://docs.docker.com/compose/reference/

---

### 2. Best Practices for E2E Testing with Docker

**Decision**: Isolated test environment with dedicated test data directories and S3 buckets

**Rationale**:
- Prevents test pollution by using separate bucket names per test run (e.g., `test-bucket-${Date.now()}`)
- Test data directories use temporary folders that are cleaned up after tests
- Each test suite has its own SQLite database file to avoid state conflicts
- Docker Compose test configuration uses different ports (9002/9003) to avoid conflicts with dev environment

**Alternatives Considered**:
1. **Shared test environment**: Rejected due to risk of test interference and flaky tests
2. **Per-test Docker containers**: Rejected as too slow (30s+ overhead per test)
3. **In-memory S3 mock**: Rejected as it doesn't test real S3 SDK behavior

**Best Practices Applied**:
- ✅ Isolated test data (unique buckets, temp directories, separate databases)
- ✅ Idempotent tests (can run in any order without dependencies)
- ✅ Proper cleanup (Docker down -v, temp file removal, bucket deletion)
- ✅ Health checks before tests (wait for MinIO ready before running tests)
- ✅ Timeout configuration (5-minute suite timeout, 30s per test)
- ✅ Detailed logging (test events, Docker status, file operations)

**References**:
- Testing best practices: https://testingjavascript.com/
- Docker test patterns: https://docs.docker.com/language/nodejs/run-tests/

---

### 3. Managing Test State and Cleanup

**Decision**: Use `beforeAll`/`afterAll` for suite-level setup and `afterEach` for test-level cleanup

**Rationale**:
- `beforeAll`: Initialize Docker environment, create S3 client, set up base directories
- `afterEach`: Clean up test-specific data (delete S3 objects, remove temp files, clear test database)
- `afterAll`: Destroy Docker containers, remove all test data, close connections
- This approach balances test isolation with performance (no container restart per test)

**Cleanup Strategy**:
```typescript
// Cleanup levels:
// 1. Suite level (afterAll): Docker containers, global resources
// 2. Test level (afterEach): S3 objects, temp files, database records
// 3. Error handling: Ensure cleanup even on test failure (try/finally blocks)

afterEach(async () => {
  // Clean S3 bucket
  await deleteAllObjects(s3Client, testBucket);

  // Remove temp files
  await fs.rm(testDataDir, { recursive: true, force: true });

  // Clear database
  db.exec('DELETE FROM processing_jobs; DELETE FROM progress_records;');
});

afterAll(async () => {
  // Close connections
  db.close();

  // Remove Docker resources
  execSync('docker-compose -f docker/test/docker-compose.test.yml down -v');
});
```

**Alternatives Considered**:
1. **Manual cleanup only**: Rejected as it leads to resource leaks on test failures
2. **Per-test Docker restart**: Rejected due to performance impact (30s+ per test)
3. **Persistent test data**: Rejected as it causes flaky tests due to state carryover

**References**:
- Jest lifecycle hooks: https://jestjs.io/docs/setup-teardown
- Resource cleanup patterns: https://kentcdodds.com/blog/common-mistakes-with-react-testing-library#not-cleaning-up

---

### 4. Mock Data Generation Strategies

**Decision**: Programmatic generation using `tar-stream` and `Buffer` with predefined file templates

**Rationale**:
- Generates consistent, reproducible test data (same files every test run)
- Avoids committing binary files to repository (generates on-the-fly)
- Allows testing specific scenarios (corrupted archives, large files, special characters)
- Uses existing project dependencies (tar-stream, no new packages needed)

**Mock Data Categories**:
1. **Archive files** (.tar, .gz, .zip, .tar.gz): 4 files with embedded content
2. **Regular files** (.csv, .json, .txt): 6 files with structured data
3. **Edge cases**: 2 files (corrupted archive, file with special chars in name)

**Implementation**:
```typescript
// tests/e2e/setup/mock-data-generator.ts
export async function generateMockFiles(targetDir: string) {
  // Regular files
  await fs.writeFile(
    path.join(targetDir, 'data.csv'),
    'id,name,value\n1,test,100\n2,test2,200\n'
  );

  await fs.writeFile(
    path.join(targetDir, 'config.json'),
    JSON.stringify({ key: 'value', items: [1, 2, 3] }, null, 2)
  );

  // Archive files
  await createTarArchive(
    path.join(targetDir, 'archive.tar'),
    [
      { name: 'file1.txt', content: 'Test content 1' },
      { name: 'file2.txt', content: 'Test content 2' }
    ]
  );

  // Edge case: corrupted archive
  await fs.writeFile(
    path.join(targetDir, 'corrupted.tar'),
    'NOT A VALID TAR FILE'
  );
}
```

**Alternatives Considered**:
1. **Committed test fixtures**: Rejected due to repository bloat and versioning issues
2. **External test data files**: Rejected as it adds deployment dependency
3. **faker.js for random data**: Rejected as randomness makes tests non-deterministic

**References**:
- tar-stream API: https://github.com/mafintosh/tar-stream
- Test data patterns: https://martinfowler.com/articles/practical-test-pyramid.html#TestData

---

### 5. Testing Script Restart/Resume Scenarios

**Decision**: Use child process spawn with explicit SIGTERM/SIGINT handling and state verification

**Rationale**:
- Spawns the main script as a child process that can be controlled from tests
- Tests can send signals (SIGTERM) to trigger graceful shutdown
- State verification checks database records before/after restart
- Validates that processed files aren't reprocessed (idempotency check)

**Restart Test Pattern**:
```typescript
// tests/e2e/scenarios/script-restart-resume.test.ts
test('Script resumes from checkpoint after restart', async () => {
  // 1. Start script and wait for partial processing
  const process = spawn('node', ['dist/index.js'], {
    env: { ...process.env, CONFIG_PATH: testConfigPath }
  });

  // 2. Wait for 50% of files processed
  await waitForCondition(() => {
    const progress = db.prepare('SELECT COUNT(*) FROM progress_records WHERE status = "done"').get();
    return progress['COUNT(*)'] >= 5; // 5 out of 10 files
  }, 60000);

  // 3. Send graceful shutdown signal
  process.kill('SIGTERM');
  await waitForExit(process, 10000);

  // 4. Capture state snapshot
  const beforeRestart = db.prepare('SELECT * FROM progress_records').all();

  // 5. Restart script
  const process2 = spawn('node', ['dist/index.js'], {
    env: { ...process.env, CONFIG_PATH: testConfigPath }
  });

  // 6. Wait for completion
  await waitForCondition(() => {
    const progress = db.prepare('SELECT COUNT(*) FROM progress_records WHERE status = "done"').get();
    return progress['COUNT(*)'] === 10; // All files done
  }, 60000);

  // 7. Verify no reprocessing
  const afterRestart = db.prepare('SELECT * FROM progress_records').all();
  const reprocessed = afterRestart.filter(record =>
    beforeRestart.some(before =>
      before.file_id === record.file_id &&
      before.processed_at !== record.processed_at
    )
  );

  expect(reprocessed).toHaveLength(0);
});
```

**Alternatives Considered**:
1. **Mock state instead of real restart**: Rejected as it doesn't test actual resume logic
2. **Docker container restart**: Rejected as script runs inside tests, not in container
3. **SIGKILL for testing**: Rejected as it doesn't test graceful shutdown path

**References**:
- Node.js child_process: https://nodejs.org/api/child_process.html
- Signal handling: https://nodejs.org/api/process.html#process_signal_events
- Process management testing: https://github.com/tapjs/signal-exit

---

## Technology Stack Summary

Based on research, the following technologies will be used:

### Core Testing
- **Jest 30.x**: Test runner with global setup/teardown
- **@types/jest**: TypeScript definitions
- **ts-jest**: TypeScript support for Jest

### Docker Management
- **docker-compose CLI**: Container orchestration (no new npm packages)
- **child_process.execSync**: For running docker-compose commands

### Test Utilities
- **node:fs/promises**: File operations and cleanup
- **node:child_process**: Script spawning and process control
- **better-sqlite3**: Direct database access for state verification
- **@aws-sdk/client-s3**: S3 operations (already in project)
- **tar-stream**: Archive creation (already in project)

### No Additional Dependencies Required
All required functionality is available through existing project dependencies and Node.js built-ins.

---

## Implementation Checklist

- [ ] Create `docker/test/docker-compose.test.yml` with MinIO on test ports
- [ ] Create `tests/setup.ts` for Docker initialization
- [ ] Create `tests/teardown.ts` for cleanup
- [ ] Create `tests/e2e/setup/mock-data-generator.ts` for test data
- [ ] Create `tests/e2e/helpers/docker-manager.ts` for Docker operations
- [ ] Create `tests/e2e/helpers/s3-test-client.ts` for S3 test utilities
- [ ] Create `tests/e2e/helpers/process-controller.ts` for script control
- [ ] Create `tests/e2e/setup/docker-environment.test.ts` (P1 tests)
- [ ] Create `tests/e2e/scenarios/file-tracking-migration.test.ts` (P2 tests)
- [ ] Create `tests/e2e/scenarios/script-restart-resume.test.ts` (P3 tests)
- [ ] Create `tests/e2e/scenarios/state-validation.test.ts` (P4 tests)
- [ ] Update `jest.config.js` with E2E test configuration
- [ ] Update `package.json` with test scripts

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Docker not installed on CI | High | Add Docker availability check in setup.ts, fail fast with clear message |
| Port conflicts (9000/9001) | Medium | Use different ports for test environment (9002/9003) |
| Slow test execution (>5min) | Medium | Run tests in parallel where possible, optimize Docker startup |
| Flaky tests due to timing | High | Add robust wait conditions with timeouts, avoid hard-coded sleeps |
| Incomplete cleanup on failures | Medium | Use try/finally blocks, Jest afterAll guaranteed execution |
| Test data generation failures | Low | Pre-validate generated data, add clear error messages |

---

## Next Steps

Proceed to **Phase 1: Design & Contracts** to create:
1. `data-model.md` - Test data structures and state models
2. `contracts/test-expectations.yaml` - Expected test outcomes
3. `quickstart.md` - How to run the E2E tests
