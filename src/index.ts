import { getConfig } from './config/config.js';
import { initLogger, getLogger } from './lib/logger.js';
import { FileMonitor } from './services/FileMonitor.js';
import { S3Uploader } from './services/S3Uploader.js';
import { FileProcessor } from './services/FileProcessor.js';
import { ProgressTracker } from './services/ProgressTracker.js';
import { ParquetConverter } from './services/ParquetConverter.js';
import { ArchiveExtractor } from './services/ArchiveExtractor.js';
import { ProcessingStatus } from './types/index.js';
import { mkdir } from 'fs/promises';

let fileMonitor: FileMonitor | null = null;
let fileProcessor: FileProcessor | null = null;
let progressTracker: ProgressTracker | null = null;
let parquetConverter: ParquetConverter | null = null;
let archiveExtractor: ArchiveExtractor | null = null;

/**
 * Perform startup recovery:
 * - Check for incomplete uploads in progress database
 * - Verify S3 completion markers
 * - Clean up incomplete uploads
 * - Mark incomplete records as pending for retry
 */
async function performStartupRecovery(
  s3Uploader: S3Uploader,
  progressTracker: ProgressTracker,
  logger: ReturnType<typeof getLogger>
): Promise<void> {
  logger.info('Starting crash recovery check...');

  // Get all in-progress records
  const inProgressRecords = progressTracker.getByStatus(ProcessingStatus.IN_PROGRESS);

  if (inProgressRecords.length === 0) {
    logger.info('No incomplete uploads found');
    return;
  }

  logger.info({ count: inProgressRecords.length }, 'Found incomplete uploads, verifying...');

  let cleanedUp = 0;
  let resumed = 0;

  for (const record of inProgressRecords) {
    if (!record.s3Key) {
      // No S3 key, mark as pending for retry
      progressTracker.delete(record.filePath);
      resumed++;
      logger.info({ filePath: record.filePath }, 'Marked for retry (no S3 key)');
      continue;
    }

    // Check if upload has completion marker
    const isComplete = await s3Uploader.verifyUpload(record.s3Key, null);

    if (isComplete) {
      // Upload was complete, update record
      progressTracker.markComplete(record.filePath, record.s3Key, record.sizeBytes ?? 0);
      logger.info({ filePath: record.filePath, s3Key: record.s3Key }, 'Completed upload found, updated record');
    } else {
      // Incomplete upload, clean up S3 and mark for retry
      const wasCleanedUp = await s3Uploader.cleanupIncompleteUpload(record.s3Key);
      if (wasCleanedUp) {
        cleanedUp++;
        logger.info({ filePath: record.filePath, s3Key: record.s3Key }, 'Cleaned up incomplete upload');
      }

      progressTracker.delete(record.filePath);
      resumed++;
    }
  }

  logger.info(
    { cleanedUp, resumed, total: inProgressRecords.length },
    'Crash recovery complete'
  );
}

async function main() {
  try {
    // Load configuration
    const config = getConfig();

    // Initialize logger
    initLogger(config.logging);
    const logger = getLogger();

    logger.info('Data File Processor starting...');
    logger.info({ config: {
      watchPath: config.monitoring.watchPath,
      s3Bucket: config.s3.bucket,
      s3Endpoint: config.s3.endpoint,
    }}, 'Configuration loaded');

    // Ensure error directory exists
    await mkdir(config.processing.errorDirectory, { recursive: true });
    logger.info({ errorDirectory: config.processing.errorDirectory }, 'Error directory ready');

    // Initialize services
    const s3Uploader = new S3Uploader(config.s3);
    progressTracker = new ProgressTracker(config.processing.progressDbPath);
    parquetConverter = new ParquetConverter(config.processing);
    archiveExtractor = new ArchiveExtractor();

    // Perform startup recovery
    await performStartupRecovery(s3Uploader, progressTracker, logger);

    fileProcessor = new FileProcessor(config, s3Uploader, progressTracker, parquetConverter, archiveExtractor);
    fileMonitor = new FileMonitor(config.monitoring);

    // Set up event handlers
    fileMonitor.on('fileReady', async (file) => {
      logger.info({ filePath: file.path, type: file.type }, 'File detected');

      try {
        await fileProcessor!.processFile(file);
      } catch (error) {
        logger.error({ filePath: file.path, error }, 'Failed to process file');
      }
    });

    fileMonitor.on('error', (error) => {
      logger.error({ error }, 'File monitor error');
    });

    // Start file monitoring
    fileMonitor.start();

    logger.info('Data File Processor running - monitoring for files...');
    logger.info({ watchPath: config.monitoring.watchPath }, 'Watching directory');

  } catch (error) {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  const logger = getLogger();
  logger.info({ signal }, 'Shutting down gracefully...');

  try {
    // Stop file monitor
    if (fileMonitor) {
      await fileMonitor.stop();
    }

    // Wait for active jobs to complete (with timeout)
    if (fileProcessor) {
      const activeJobs = fileProcessor.getActiveJobsCount();
      if (activeJobs > 0) {
        logger.info({ activeJobs }, 'Waiting for active jobs to complete...');

        const timeout = 30000; // 30 seconds
        const startTime = Date.now();

        while (fileProcessor.getActiveJobsCount() > 0) {
          if (Date.now() - startTime > timeout) {
            logger.warn('Shutdown timeout reached, forcing exit');
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    // Close progress tracker
    if (progressTracker) {
      progressTracker.close();
      logger.info('Progress tracker closed');
    }

    // Close parquet converter
    if (parquetConverter) {
      parquetConverter.close();
      logger.info('Parquet converter closed');
    }

    logger.info('Shutdown complete');
    process.exit(0);

  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start application
main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
