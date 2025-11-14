import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set required environment variables
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ACCESS_KEY = 'test-access-key';
    process.env.S3_SECRET_KEY = 'test-secret-key';
    process.env.WATCH_PATH = './test-data';
    process.env.ERROR_DIRECTORY = './test-data/errors';
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should load configuration from environment variables', async () => {
    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.s3.endpoint).toBe('http://localhost:9000');
    expect(config.s3.region).toBe('us-east-1');
    expect(config.s3.bucket).toBe('test-bucket');
    expect(config.monitoring.watchPath).toContain('test-data');
  });

  it('should set default values for optional configuration', async () => {
    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();

    expect(config.processing.maxConcurrency).toBe(4);
    expect(config.processing.maxRetries).toBe(3);
    expect(config.processing.parquetCompression).toBe('ZSTD');
  });

  it('should throw error when required environment variables are missing', async () => {
    delete process.env.S3_ENDPOINT;

    const { loadConfig } = await import('../../src/config/config.js');

    expect(() => loadConfig()).toThrow('Missing required environment variable: S3_ENDPOINT');
  });
});
