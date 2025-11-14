# E2E Tests

End-to-end tests that verify the complete data file processor workflow with real S3 storage.

## Prerequisites

1. **Docker and Docker Compose** installed
2. **MinIO Client (mc)** installed:
   ```bash
   # macOS
   brew install minio/stable/mc

   # Linux
   wget https://dl.min.io/client/mc/release/linux-amd64/mc
   chmod +x mc
   sudo mv mc /usr/local/bin/
   ```

3. **Build the application**:
   ```bash
   npm run build
   ```

## Running E2E Tests

### 1. Start MinIO

```bash
docker-compose up -d minio
```

Wait for MinIO to be fully ready (~10 seconds):
```bash
# Check MinIO health
curl http://localhost:9000/minio/health/live
```

### 2. Run E2E Tests

```bash
npm run test:e2e
```

This will:
- Create test data directories
- Start the application
- Create various test files (CSV, JSON, archives, etc.)
- Verify files are processed correctly
- Test crash recovery
- Clean up after tests

### 3. Stop MinIO (when done)

```bash
docker-compose down -v
```

## Test Scenarios

The e2e tests cover:

### US1: Basic File Upload
- ✅ Upload regular text files to S3
- ✅ Skip already processed files on restart

### US2: Crash Recovery
- ✅ Resume incomplete uploads after crash (SIGKILL)
- ✅ Process files added while app was down

### US3: Database File Conversion
- ✅ Convert CSV to Parquet with compression
- ✅ Convert JSON to Parquet
- ✅ Handle mixed file types correctly

### US4: Archive Extraction
- ✅ Extract ZIP archives
- ✅ Upload archive contents (not the archive itself)
- ✅ Convert database files within archives

### Performance
- ✅ Handle 20+ concurrent files
- ✅ Verify no errors during high volume

## Test Structure

```
tests/e2e/
├── README.md           # This file
├── helpers.ts          # Utilities for test data generation
└── app.e2e.test.ts     # Main E2E test suite
```

## Troubleshooting

### MinIO Not Running
```
Error: MinIO is not running
```
**Solution**: Start MinIO with `docker-compose up -d minio`

### MinIO Client Not Configured
```
Error: mc alias 'local' not found
```
**Solution**: The tests auto-configure mc, but you can manually set it up:
```bash
mc alias set local http://localhost:9000 minioadmin minioadmin
```

### Port Already in Use
```
Error: bind: address already in use
```
**Solution**: Stop existing MinIO instance:
```bash
docker-compose down
docker ps | grep minio
```

### Tests Timeout
If tests are timing out, increase timeout values in test files or check:
- MinIO is accessible: `curl http://localhost:9000/minio/health/live`
- Application builds successfully: `npm run build`
- No zombie processes: `pkill -f "node.*data-processor"`

### Clean Test State

To reset everything:
```bash
# Stop application
pkill -f "node.*data-processor"

# Remove test data
rm -rf data/ errors/ progress.db

# Clear S3
mc rm --recursive --force local/data-processor-bucket/

# Restart MinIO
docker-compose restart minio
```

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
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

      - name: Install MinIO Client
        run: |
          wget https://dl.min.io/client/mc/release/linux-amd64/mc
          chmod +x mc
          sudo mv mc /usr/local/bin/

      - name: Start MinIO
        run: docker-compose up -d minio

      - name: Wait for MinIO
        run: |
          timeout 30 bash -c 'until curl -f http://localhost:9000/minio/health/live; do sleep 1; done'

      - name: Build application
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Cleanup
        if: always()
        run: docker-compose down -v
```

## Test Execution Time

Expected execution times:
- Basic File Upload: ~60 seconds
- Crash Recovery: ~120 seconds
- Database Conversion: ~90 seconds
- Archive Extraction: ~90 seconds
- Performance Tests: ~120 seconds

**Total**: ~8-10 minutes for full suite

## Writing New E2E Tests

See [helpers.ts](./helpers.ts) for utilities:

```typescript
import {
  generateCSV,
  generateJSON,
  generateTextFile,
  createZipArchive,
  waitFor,
  listS3Files,
  queryProgressDB,
} from './helpers.js';

it('should test something', async () => {
  // Start app
  appProcess = await startApp();

  // Create test data
  generateCSV(join(TEST_DATA_DIR, 'test.csv'), 100);

  // Wait for processing
  await waitFor(async () => {
    const files = listS3Files(S3_BUCKET);
    return files.some(f => f.endsWith('.parquet'));
  }, 30000);

  // Assertions
  expect(listS3Files(S3_BUCKET)).toContain('test.parquet');

  // Cleanup
  await stopApp(appProcess);
});
```
