import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

export interface TestFile {
  path: string;
  content: string | Buffer;
  type: 'regular' | 'csv' | 'json' | 'archive';
}

// S3 Client for tests
const s3Client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  },
  forcePathStyle: true,
});

/**
 * Create test data directory structure
 */
export function setupTestDataDir(baseDir: string): void {
  if (existsSync(baseDir)) {
    rmSync(baseDir, { recursive: true, force: true });
  }
  mkdirSync(baseDir, { recursive: true });
}

/**
 * Generate a CSV file with specified rows
 */
export function generateCSV(filePath: string, rows: number): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let csv = 'id,name,email,timestamp\n';
  for (let i = 1; i <= rows; i++) {
    csv += `${i},User${i},user${i}@example.com,2025-11-15T${String(i % 24).padStart(2, '0')}:00:00Z\n`;
  }
  writeFileSync(filePath, csv);
}

/**
 * Generate a JSON file with specified records
 */
export function generateJSON(filePath: string, records: number): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const data = [];
  for (let i = 1; i <= records; i++) {
    data.push({
      id: i,
      name: `Product${i}`,
      price: (Math.random() * 100).toFixed(2),
      inStock: i % 2 === 0,
    });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Generate a regular text file
 */
export function generateTextFile(filePath: string, content: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content);
}

/**
 * Generate a SQL file with CREATE TABLE statements
 */
export function generateSQL(filePath: string, tables: number = 3): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let sql = '-- Database Schema\n';
  sql += '-- Generated for testing purposes\n\n';

  for (let i = 1; i <= tables; i++) {
    sql += `CREATE TABLE IF NOT EXISTS table_${i} (\n`;
    sql += `  id INTEGER PRIMARY KEY AUTOINCREMENT,\n`;
    sql += `  name TEXT NOT NULL,\n`;
    sql += `  value REAL,\n`;
    sql += `  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
    sql += `);\n\n`;

    sql += `CREATE INDEX IF NOT EXISTS idx_table_${i}_name ON table_${i}(name);\n\n`;
  }

  writeFileSync(filePath, sql);
}

/**
 * Create a ZIP archive with files
 */
export async function createZipArchive(
  outputPath: string,
  files: Array<{ name: string; content: string }>
): Promise<void> {
  const dir = join(outputPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    files.forEach((file) => {
      archive.append(file.content, { name: file.name });
    });

    archive.finalize();
  });
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 500
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await Promise.resolve(condition());
    if (result) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if MinIO is accessible
 */
export function isMinIORunning(): boolean {
  try {
    execSync('curl -f http://localhost:9000/minio/health/live', {
      stdio: 'ignore',
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if bucket exists in MinIO
 */
export async function checkBucketExists(bucket: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

/**
 * List files in S3 bucket
 */
export async function listS3Files(bucket: string): Promise<string[]> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
    });

    const response = await s3Client.send(command);

    if (!response.Contents) {
      return [];
    }

    return response.Contents
      .map(obj => obj.Key)
      .filter((key): key is string => key !== undefined);
  } catch (error) {
    console.error('Failed to list S3 files:', error);
    return [];
  }
}

/**
 * Get file from S3
 */
export async function getS3File(bucket: string, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`File not found: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Query progress database
 */
export function queryProgressDB(
  dbPath: string,
  query: string
): Array<Record<string, any>> {
  try {
    const output = execSync(
      `sqlite3 -json "${dbPath}" "${query}"`,
      { encoding: 'utf-8' }
    );

    if (!output.trim()) {
      return [];
    }

    return JSON.parse(output);
  } catch (error) {
    console.error('Failed to query database:', error);
    return [];
  }
}

/**
 * Clear S3 bucket
 */
export async function clearS3Bucket(bucket: string): Promise<void> {
  try {
    // List all objects
    const objects = await listS3Files(bucket);

    if (objects.length === 0) {
      return;
    }

    // Delete all objects
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: objects.map(key => ({ Key: key })),
      },
    });

    await s3Client.send(command);
  } catch (error) {
    // Ignore errors if bucket is already empty or doesn't exist
    console.warn('Failed to clear S3 bucket:', error);
  }
}

/**
 * Create bucket if it doesn't exist
 */
export async function createBucketIfNotExists(bucket: string): Promise<void> {
  try {
    const exists = await checkBucketExists(bucket);
    if (!exists) {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`Created bucket: ${bucket}`);
    }
  } catch (error) {
    console.warn('Failed to create bucket:', error);
  }
}

/**
 * Setup MinIO client configuration
 * (Not needed with AWS SDK, but kept for API compatibility)
 */
export async function setupMinIOClient(bucket: string = 'data-processor-bucket'): Promise<void> {
  // Using AWS SDK directly instead of mc CLI
  console.log('Using AWS SDK for S3 operations (no mc CLI required)');

  // Ensure bucket exists
  await createBucketIfNotExists(bucket);
}
