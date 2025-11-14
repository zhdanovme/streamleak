import * as duckdb from 'duckdb';
import { Readable } from 'stream';
import { unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { ProcessingConfig } from '../types/index.js';
import { getLogger, createChildLogger } from '../lib/logger.js';

export class ParquetConverter {
  private config: ProcessingConfig;
  private logger = getLogger();
  private db: duckdb.Database;

  constructor(config: ProcessingConfig) {
    this.config = config;

    // Initialize DuckDB in-memory
    this.db = new duckdb.Database(':memory:');
    this.logger.info('ParquetConverter initialized with DuckDB');
  }

  /**
   * Convert CSV file to Parquet
   * @param inputPath Input CSV file path
   * @param outputPath Output Parquet file path (temporary)
   * @returns Output file path
   */
  async convertCsvToParquet(inputPath: string, outputPath: string): Promise<string> {
    const logger = createChildLogger({ inputPath, outputPath });
    logger.info('Converting CSV to Parquet');

    return new Promise((resolve, reject) => {
      const conn = this.db.connect();

      const query = `
        COPY (SELECT * FROM read_csv_auto('${inputPath}'))
        TO '${outputPath}'
        (FORMAT PARQUET, COMPRESSION '${this.config.parquetCompression}');
      `;

      conn.all(query, (err) => {
        if (err) {
          logger.error({ error: err }, 'Failed to convert CSV to Parquet');
          conn.close();
          reject(err);
          return;
        }

        logger.info('CSV converted to Parquet successfully');
        conn.close();
        resolve(outputPath);
      });
    });
  }

  /**
   * Convert JSON file to Parquet
   * @param inputPath Input JSON file path
   * @param outputPath Output Parquet file path (temporary)
   * @returns Output file path
   */
  async convertJsonToParquet(inputPath: string, outputPath: string): Promise<string> {
    const logger = createChildLogger({ inputPath, outputPath });
    logger.info('Converting JSON to Parquet');

    return new Promise((resolve, reject) => {
      const conn = this.db.connect();

      const query = `
        COPY (SELECT * FROM read_json_auto('${inputPath}'))
        TO '${outputPath}'
        (FORMAT PARQUET, COMPRESSION '${this.config.parquetCompression}');
      `;

      conn.all(query, (err) => {
        if (err) {
          logger.error({ error: err }, 'Failed to convert JSON to Parquet');
          conn.close();
          reject(err);
          return;
        }

        logger.info('JSON converted to Parquet successfully');
        conn.close();
        resolve(outputPath);
      });
    });
  }

  /**
   * Convert database file to Parquet and return as stream
   * @param inputPath Input file path
   * @param fileType File extension (.csv, .json, .xml, etc.)
   * @returns Readable stream of Parquet data and temp file path
   */
  async convertToParquetStream(
    inputPath: string,
    fileType: string
  ): Promise<{ stream: Readable; tempFilePath: string; parquetFileName: string }> {
    const logger = createChildLogger({ inputPath, fileType });

    // Generate temporary output path
    const tempFilePath = join(tmpdir(), `${randomUUID()}.parquet`);

    try {
      // Convert based on file type
      if (fileType === '.csv' || fileType === '.tsv') {
        await this.convertCsvToParquet(inputPath, tempFilePath);
      } else if (fileType === '.json' || fileType === '.jsonl') {
        await this.convertJsonToParquet(inputPath, tempFilePath);
      } else if (fileType === '.xml') {
        // XML conversion requires special handling
        // For now, treat as CSV (DuckDB doesn't natively support XML)
        throw new Error('XML to Parquet conversion not yet implemented');
      } else {
        throw new Error(`Unsupported file type for Parquet conversion: ${fileType}`);
      }

      // Create stream from temporary Parquet file
      const stream = createReadStream(tempFilePath);

      // Get output file name (replace extension)
      const parquetFileName = inputPath.replace(/\.[^.]+$/, '.parquet');

      logger.info({ tempFilePath, parquetFileName }, 'Parquet conversion complete, streaming');

      return { stream, tempFilePath, parquetFileName };

    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      logger.error({ error }, 'Failed to convert to Parquet');
      throw error;
    }
  }

  /**
   * Clean up temporary Parquet file
   * @param tempFilePath Temporary file path
   */
  async cleanupTempFile(tempFilePath: string): Promise<void> {
    try {
      await unlink(tempFilePath);
      this.logger.debug({ tempFilePath }, 'Temporary Parquet file deleted');
    } catch (error) {
      this.logger.warn({ tempFilePath, error }, 'Failed to delete temporary Parquet file');
    }
  }

  /**
   * Close DuckDB connection
   */
  close(): void {
    this.db.close();
    this.logger.info('ParquetConverter closed');
  }
}
