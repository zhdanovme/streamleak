import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { getLogger } from './logger.js';

/**
 * Calculate SHA256 checksum from a file path
 * @param filePath Absolute path to file
 * @returns Promise that resolves with hex-encoded checksum
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  const logger = getLogger();
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const checksum = hash.digest('hex');
      logger.debug({ filePath, checksum }, 'File checksum calculated');
      resolve(checksum);
    });

    stream.on('error', (error) => {
      logger.error({ filePath, error }, 'Error calculating file checksum');
      reject(error);
    });
  });
}

/**
 * Calculate SHA256 checksum from a readable stream
 * @param stream Readable stream
 * @returns Promise that resolves with hex-encoded checksum
 */
export async function calculateStreamChecksum(stream: Readable): Promise<string> {
  const logger = getLogger();
  const hash = createHash('sha256');

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const checksum = hash.digest('hex');
      logger.debug({ checksum }, 'Stream checksum calculated');
      resolve(checksum);
    });

    stream.on('error', (error) => {
      logger.error({ error }, 'Error calculating stream checksum');
      reject(error);
    });
  });
}

/**
 * Calculate SHA256 checksum from a buffer
 * @param buffer Buffer to hash
 * @returns Hex-encoded checksum
 */
export function calculateBufferChecksum(buffer: Buffer): string {
  const hash = createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}
