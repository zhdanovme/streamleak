import { existsSync } from 'fs';
import { resolve } from 'path';
import type { AppConfig } from '../types/index.js';

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): AppConfig {
  // S3 Configuration
  const s3 = {
    endpoint: getEnv('S3_ENDPOINT'),
    region: getEnv('S3_REGION'),
    bucket: getEnv('S3_BUCKET'),
    accessKeyId: getEnv('S3_ACCESS_KEY'),
    secretAccessKey: getEnv('S3_SECRET_KEY'),
    forcePathStyle: getEnvBoolean('S3_FORCE_PATH_STYLE', true),
  };

  // Monitoring Configuration
  const watchPath = getEnv('WATCH_PATH');
  const watchPathResolved = resolve(watchPath);

  if (!existsSync(watchPathResolved)) {
    throw new Error(`Watch path does not exist: ${watchPathResolved}`);
  }

  const monitoring = {
    watchPath: watchPathResolved,
    stabilityThreshold: getEnvNumber('STABILITY_THRESHOLD', 2000),
    pollInterval: getEnvNumber('POLL_INTERVAL', 100),
    ignoreInitial: getEnvBoolean('IGNORE_INITIAL', false),
  };

  // Processing Configuration
  const errorDirectory = getEnv('ERROR_DIRECTORY', './errors');
  const errorDirectoryResolved = resolve(errorDirectory);

  const processing = {
    maxConcurrency: getEnvNumber('MAX_CONCURRENCY', 4),
    maxRetries: getEnvNumber('MAX_RETRIES', 3),
    retryDelay: getEnvNumber('RETRY_DELAY', 1000),
    errorDirectory: errorDirectoryResolved,
    progressDbPath: getEnv('PROGRESS_DB_PATH', './progress.db'),
    parquetCompression: (getEnv('PARQUET_COMPRESSION', 'ZSTD') as 'ZSTD' | 'SNAPPY'),
  };

  // Validate compression type
  if (!['ZSTD', 'SNAPPY'].includes(processing.parquetCompression)) {
    throw new Error(`Invalid PARQUET_COMPRESSION: ${processing.parquetCompression}. Must be ZSTD or SNAPPY.`);
  }

  // Logging Configuration
  const logging = {
    level: (getEnv('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error'),
    pretty: getEnvBoolean('LOG_PRETTY', process.env.NODE_ENV !== 'production'),
  };

  // Validate log level
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(logging.level)) {
    throw new Error(`Invalid LOG_LEVEL: ${logging.level}. Must be one of: ${validLogLevels.join(', ')}`);
  }

  return {
    s3,
    monitoring,
    processing,
    logging,
  };
}

// Export singleton config instance
let config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

// For testing: reset config
export function resetConfig(): void {
  config = null;
}
