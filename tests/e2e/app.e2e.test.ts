import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  setupTestDataDir,
  generateCSV,
  generateJSON,
  generateTextFile,
  createZipArchive,
  waitFor,
  sleep,
  isMinIORunning,
  listS3Files,
  queryProgressDB,
  clearS3Bucket,
  setupMinIOClient,
} from './helpers.js';

const TEST_DATA_DIR = join(process.cwd(), 'data');
const ERROR_DIR = join(process.cwd(), 'errors');
const PROGRESS_DB = join(process.cwd(), 'progress.db');
const S3_BUCKET = 'data-processor-bucket';

describe('E2E: Data File Processor', () => {
  let appProcess: ChildProcess | null = null;

  beforeAll(async () => {
    // Verify MinIO is running
    if (!isMinIORunning()) {
      throw new Error(
        'MinIO is not running. Please start it with: docker-compose up -d minio'
      );
    }

    // Setup MinIO client and create bucket
    await setupMinIOClient(S3_BUCKET);

    // Ensure bucket is clean
    await clearS3Bucket(S3_BUCKET);
  });

  beforeEach(async () => {
    // Clean up from previous tests
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    if (existsSync(ERROR_DIR)) {
      rmSync(ERROR_DIR, { recursive: true, force: true });
    }
    if (existsSync(PROGRESS_DB)) {
      rmSync(PROGRESS_DB, { force: true });
    }

    // Setup fresh directories
    setupTestDataDir(TEST_DATA_DIR);
    setupTestDataDir(ERROR_DIR);

    // Clear S3 bucket
    await clearS3Bucket(S3_BUCKET);
  });

  afterAll(async () => {
    // Stop application if running
    if (appProcess) {
      appProcess.kill('SIGTERM');
      await sleep(2000);
    }

    // Clean up test artifacts
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    if (existsSync(ERROR_DIR)) {
      rmSync(ERROR_DIR, { recursive: true, force: true });
    }
    if (existsSync(PROGRESS_DB)) {
      rmSync(PROGRESS_DB, { force: true });
    }
  });

  /**
   * Start the application
   */
  async function startApp(): Promise<ChildProcess> {
    const proc = spawn('npm', ['start'], {
      env: {
        ...process.env,
        // S3 Configuration
        S3_ENDPOINT: 'http://localhost:9000',
        S3_REGION: 'us-east-1',
        S3_BUCKET,
        S3_ACCESS_KEY: 'minioadmin',
        S3_SECRET_KEY: 'minioadmin',
        S3_FORCE_PATH_STYLE: 'true',
        // File Monitoring
        WATCH_PATH: TEST_DATA_DIR,
        ERROR_DIRECTORY: ERROR_DIR,
        PROGRESS_DB_PATH: PROGRESS_DB,
        LOG_LEVEL: 'debug',
        // Processing
        MAX_CONCURRENCY: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for app to be ready (database created and schema initialized)
    await waitFor(() => {
      if (!existsSync(PROGRESS_DB)) {
        return false;
      }

      // Check if the database schema is ready
      try {
        const result = queryProgressDB(
          PROGRESS_DB,
          "SELECT name FROM sqlite_master WHERE type='table' AND name='file_progress'"
        );
        return result.length > 0;
      } catch {
        return false;
      }
    }, 15000);

    return proc;
  }

  /**
   * Stop the application
   */
  async function stopApp(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    proc.kill(signal);
    await sleep(2000);
  }

  describe('US1: Basic File Upload', () => {
    it('should upload regular text file to S3', async () => {
      // Start application
      appProcess = await startApp();

      // Create test file
      const testFile = join(TEST_DATA_DIR, 'test.txt');
      generateTextFile(testFile, 'Hello, World!');

      // Wait for file to be processed
      await waitFor(async () => {
        const files = await listS3Files(S3_BUCKET);
        return files.includes('test.txt');
      }, 30000);

      // Verify file in S3
      const s3Files = await listS3Files(S3_BUCKET);
      expect(s3Files).toContain('test.txt');

      // Verify progress DB
      const records = queryProgressDB(
        PROGRESS_DB,
        "SELECT status FROM file_progress WHERE file_path LIKE '%test.txt'"
      );
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('completed');

      await stopApp(appProcess);
      appProcess = null;
    }, 60000);

    it('should skip already processed files on restart', async () => {
      // Start application
      appProcess = await startApp();

      // Create and process file
      const testFile = join(TEST_DATA_DIR, 'restart-test.txt');
      generateTextFile(testFile, 'Initial content');

      await waitFor(async () => {
        const files = await listS3Files(S3_BUCKET);
        return files.includes('restart-test.txt');
      }, 30000);

      // Get initial S3 file count
      const initialFiles = await listS3Files(S3_BUCKET);
      const initialCount = initialFiles.length;

      // Restart application
      await stopApp(appProcess);
      await sleep(2000);
      appProcess = await startApp();
      await sleep(5000);

      // Verify file not re-uploaded
      const finalFiles = await listS3Files(S3_BUCKET);
      expect(finalFiles.length).toBe(initialCount);

      // Verify DB still shows completed
      const records = queryProgressDB(
        PROGRESS_DB,
        "SELECT status FROM file_progress WHERE file_path LIKE '%restart-test.txt'"
      );
      expect(records[0].status).toBe('completed');

      await stopApp(appProcess);
      appProcess = null;
    }, 90000);
  });

  describe('US2: Crash Recovery', () => {
    it('should resume incomplete uploads after crash', async () => {
      // Start application
      appProcess = await startApp();

      // Create multiple files
      for (let i = 1; i <= 3; i++) {
        generateTextFile(join(TEST_DATA_DIR, `file-${i}.txt`), `Content ${i}`);
        await sleep(2000);
      }

      // Wait for first 2 files to complete
      await waitFor(async () => {
        const records = queryProgressDB(
          PROGRESS_DB,
          "SELECT COUNT(*) as count FROM file_progress WHERE status = 'completed'"
        );
        return records.length > 0 && records[0].count >= 2;
      }, 30000);

      // Simulate crash
      await stopApp(appProcess, 'SIGKILL');
      await sleep(2000);

      // Create one more file while app is down
      generateTextFile(join(TEST_DATA_DIR, 'file-4.txt'), 'Content 4');

      // Restart application
      appProcess = await startApp();

      // Wait for all files to be processed
      await waitFor(async () => {
        const records = queryProgressDB(
          PROGRESS_DB,
          "SELECT COUNT(*) as count FROM file_progress WHERE status = 'completed'"
        );
        return records.length > 0 && records[0].count >= 4;
      }, 40000);

      // Verify all files in S3
      const s3Files = await listS3Files(S3_BUCKET);
      expect(s3Files).toContain('file-1.txt');
      expect(s3Files).toContain('file-2.txt');
      expect(s3Files).toContain('file-3.txt');
      expect(s3Files).toContain('file-4.txt');

      await stopApp(appProcess);
      appProcess = null;
    }, 120000);
  });

  describe('US3: Database File Conversion', () => {
    it('should convert CSV to Parquet', async () => {
      // Start application
      appProcess = await startApp();

      // Create CSV file
      const csvFile = join(TEST_DATA_DIR, 'users.csv');
      generateCSV(csvFile, 100);

      // Wait for Parquet file in S3
      await waitFor(async () => {
        const files = await listS3Files(S3_BUCKET);
        return files.some(f => f.endsWith('.parquet'));
      }, 45000);

      // Verify Parquet file exists (not CSV)
      const s3Files = await listS3Files(S3_BUCKET);
      const parquetFile = s3Files.find(f => f.includes('users') && f.endsWith('.parquet'));
      expect(parquetFile).toBeDefined();
      expect(s3Files.some(f => f.endsWith('.csv'))).toBe(false);

      // Verify progress DB
      const records = queryProgressDB(
        PROGRESS_DB,
        "SELECT status FROM file_progress WHERE file_path LIKE '%users.csv'"
      );
      expect(records[0].status).toBe('completed');

      await stopApp(appProcess);
      appProcess = null;
    }, 60000);

    it('should handle mixed file types correctly', async () => {
      // Start application
      appProcess = await startApp();

      // Create different file types
      generateCSV(join(TEST_DATA_DIR, 'data.csv'), 50);
      generateJSON(join(TEST_DATA_DIR, 'config.json'), 10);
      generateTextFile(join(TEST_DATA_DIR, 'readme.txt'), 'Documentation');

      // Wait for all files to be processed
      await waitFor(async () => {
        const records = queryProgressDB(
          PROGRESS_DB,
          "SELECT COUNT(*) as count FROM file_progress WHERE status = 'completed'"
        );
        return records.length > 0 && records[0].count >= 3;
      }, 45000);

      // Verify S3 contents
      const s3Files = await listS3Files(S3_BUCKET);

      // CSV converted to Parquet
      expect(s3Files.some(f => f.includes('data') && f.endsWith('.parquet'))).toBe(true);

      // JSON converted to Parquet
      expect(s3Files.some(f => f.includes('config') && f.endsWith('.parquet'))).toBe(true);

      // Text file uploaded as-is
      expect(s3Files).toContain('readme.txt');

      await stopApp(appProcess);
      appProcess = null;
    }, 90000);
  });

  describe('US4: Archive Extraction', () => {
    it('should extract ZIP and upload contents', async () => {
      // Start application
      appProcess = await startApp();

      // Create ZIP archive with files
      const zipPath = join(TEST_DATA_DIR, 'archive.zip');
      await createZipArchive(zipPath, [
        { name: 'document.txt', content: 'Document content' },
        { name: 'data/metrics.csv', content: 'id,value\n1,100\n2,200' },
      ]);

      // Wait for archive contents to be processed
      await waitFor(async () => {
        const files = await listS3Files(S3_BUCKET);
        return files.length >= 2;
      }, 45000);

      // Verify archive contents in S3
      const s3Files = await listS3Files(S3_BUCKET);

      // Text file from archive
      expect(s3Files.some(f => f.includes('document.txt'))).toBe(true);

      // CSV converted to Parquet
      expect(s3Files.some(f => f.includes('metrics') && f.endsWith('.parquet'))).toBe(true);

      // Archive itself should NOT be in S3
      expect(s3Files.some(f => f.endsWith('.zip'))).toBe(false);

      await stopApp(appProcess);
      appProcess = null;
    }, 90000);
  });

  describe('Performance: High Volume', () => {
    it('should handle multiple concurrent files', async () => {
      // Start application
      appProcess = await startApp();

      // Create 20 files rapidly
      const fileCount = 20;
      for (let i = 1; i <= fileCount; i++) {
        generateTextFile(
          join(TEST_DATA_DIR, `bulk-${i}.txt`),
          `Bulk content ${i}`
        );
      }

      // Wait for all files to be processed
      await waitFor(async () => {
        const records = queryProgressDB(
          PROGRESS_DB,
          "SELECT COUNT(*) as count FROM file_progress WHERE status = 'completed'"
        );
        return records.length > 0 && records[0].count >= fileCount;
      }, 90000);

      // Verify all files in S3
      const s3Files = await listS3Files(S3_BUCKET);
      expect(s3Files.length).toBeGreaterThanOrEqual(fileCount);

      // Verify no errors
      const errorRecords = queryProgressDB(
        PROGRESS_DB,
        "SELECT COUNT(*) as count FROM file_progress WHERE status = 'error'"
      );
      expect(errorRecords[0]?.count || 0).toBe(0);

      await stopApp(appProcess);
      appProcess = null;
    }, 120000);
  });
});
