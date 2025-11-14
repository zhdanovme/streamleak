import Database from 'better-sqlite3';
import { ProcessingStatus } from '../types/index.js';
import type { ProgressRecord, ProgressRecordRow } from '../models/ProgressRecord.js';
import { createProgressRecord, rowToProgressRecord } from '../models/ProgressRecord.js';
import { getLogger } from '../lib/logger.js';

export class ProgressTracker {
  private db: Database.Database;
  private logger = getLogger();

  // Prepared statements
  private insertStmt!: Database.Statement;
  private updateStatusStmt!: Database.Statement;
  private updateCompleteStmt!: Database.Statement;
  private updateFailedStmt!: Database.Statement;
  private selectByPathStmt!: Database.Statement;
  private selectByStatusStmt!: Database.Statement;
  private selectAllStmt!: Database.Statement;
  private deleteStmt!: Database.Statement;

  constructor(dbPath: string) {
    this.logger.info({ dbPath }, 'Initializing ProgressTracker');

    // Initialize database with WAL mode for better concurrency
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    // Create schema
    this.createSchema();

    // Prepare statements
    this.prepareStatements();

    this.logger.info('ProgressTracker initialized');
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
        size_bytes INTEGER,
        processed_bytes INTEGER,
        checksum TEXT,
        s3_key TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file_path ON file_progress(file_path);
      CREATE INDEX IF NOT EXISTS idx_status ON file_progress(status);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON file_progress(updated_at);
    `);

    this.logger.debug('Database schema created');
  }

  /**
   * Prepare SQL statements
   */
  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(`
      INSERT INTO file_progress (file_path, status, size_bytes, checksum, created_at, updated_at)
      VALUES (@filePath, @status, @sizeBytes, @checksum, @createdAt, @updatedAt)
    `);

    this.updateStatusStmt = this.db.prepare(`
      UPDATE file_progress
      SET status = @status, updated_at = @updatedAt
      WHERE file_path = @filePath
    `);

    this.updateCompleteStmt = this.db.prepare(`
      UPDATE file_progress
      SET status = @status,
          s3_key = @s3Key,
          processed_bytes = @processedBytes,
          updated_at = @updatedAt
      WHERE file_path = @filePath
    `);

    this.updateFailedStmt = this.db.prepare(`
      UPDATE file_progress
      SET status = @status,
          error_message = @errorMessage,
          updated_at = @updatedAt
      WHERE file_path = @filePath
    `);

    this.selectByPathStmt = this.db.prepare(`
      SELECT * FROM file_progress WHERE file_path = ?
    `);

    this.selectByStatusStmt = this.db.prepare(`
      SELECT * FROM file_progress WHERE status = ?
    `);

    this.selectAllStmt = this.db.prepare(`
      SELECT * FROM file_progress
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM file_progress WHERE file_path = ?
    `);
  }

  /**
   * Record start of file processing
   * @param filePath Absolute file path
   * @param sizeBytes File size
   * @param checksum File checksum
   */
  recordStart(filePath: string, sizeBytes: number, checksum?: string): ProgressRecord {
    const record = createProgressRecord(filePath, ProcessingStatus.PENDING);
    record.sizeBytes = sizeBytes;
    record.checksum = checksum ?? null;

    try {
      this.insertStmt.run({
        filePath: record.filePath,
        status: record.status,
        sizeBytes: record.sizeBytes,
        checksum: record.checksum,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });

      this.logger.debug({ filePath }, 'Progress record created');
      return record;

    } catch (error) {
      // Record might already exist, update it instead
      this.logger.debug({ filePath }, 'Progress record exists, updating');
      this.markInProgress(filePath);
      return this.checkIsProcessed(filePath)!;
    }
  }

  /**
   * Mark file as in progress
   * @param filePath Absolute file path
   */
  markInProgress(filePath: string): void {
    const now = Math.floor(Date.now() / 1000);

    this.updateStatusStmt.run({
      filePath,
      status: ProcessingStatus.IN_PROGRESS,
      updatedAt: now,
    });

    this.logger.debug({ filePath }, 'Marked as in_progress');
  }

  /**
   * Mark file as completed
   * @param filePath Absolute file path
   * @param s3Key S3 object key
   * @param processedBytes Bytes uploaded
   */
  markComplete(filePath: string, s3Key: string, processedBytes: number): void {
    const now = Math.floor(Date.now() / 1000);

    this.updateCompleteStmt.run({
      filePath,
      status: ProcessingStatus.COMPLETED,
      s3Key,
      processedBytes,
      updatedAt: now,
    });

    this.logger.info({ filePath, s3Key }, 'Marked as completed');
  }

  /**
   * Mark file as failed
   * @param filePath Absolute file path
   * @param errorMessage Error message
   */
  markFailed(filePath: string, errorMessage: string): void {
    const now = Math.floor(Date.now() / 1000);

    this.updateFailedStmt.run({
      filePath,
      status: ProcessingStatus.FAILED,
      errorMessage,
      updatedAt: now,
    });

    this.logger.warn({ filePath, error: errorMessage }, 'Marked as failed');
  }

  /**
   * Check if file has been processed
   * @param filePath Absolute file path
   * @returns Progress record if exists, null otherwise
   */
  checkIsProcessed(filePath: string): ProgressRecord | null {
    const row = this.selectByPathStmt.get(filePath) as ProgressRecordRow | undefined;

    if (!row) {
      return null;
    }

    return rowToProgressRecord(row);
  }

  /**
   * Get all records with a specific status
   * @param status Processing status
   * @returns Array of progress records
   */
  getByStatus(status: ProcessingStatus): ProgressRecord[] {
    const rows = this.selectByStatusStmt.all(status) as ProgressRecordRow[];
    return rows.map(rowToProgressRecord);
  }

  /**
   * Get all progress records
   * @returns Array of all progress records
   */
  getAll(): ProgressRecord[] {
    const rows = this.selectAllStmt.all() as ProgressRecordRow[];
    return rows.map(rowToProgressRecord);
  }

  /**
   * Detect modified files by comparing checksums
   * @param filePath File path
   * @param currentChecksum Current file checksum
   * @returns True if file was modified
   */
  detectModifiedFiles(filePath: string, currentChecksum: string): boolean {
    const record = this.checkIsProcessed(filePath);

    if (!record || !record.checksum) {
      return false;
    }

    const wasModified = record.checksum !== currentChecksum;

    if (wasModified) {
      this.logger.info({ filePath, oldChecksum: record.checksum, newChecksum: currentChecksum }, 'File was modified');
      // Reset to pending
      this.deleteStmt.run(filePath);
    }

    return wasModified;
  }

  /**
   * Delete progress record
   * @param filePath File path
   */
  delete(filePath: string): void {
    this.deleteStmt.run(filePath);
    this.logger.debug({ filePath }, 'Progress record deleted');
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    this.logger.info('ProgressTracker closed');
  }

  /**
   * Get database instance (for testing)
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}
