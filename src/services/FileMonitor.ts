import chokidar, { FSWatcher } from 'chokidar';
import { stat } from 'fs/promises';
import { relative, extname } from 'path';
import { EventEmitter } from 'events';
import type { MonitoringConfig } from '../types/index.js';
import { getFileType } from '../types/index.js';
import type { FileMetadata } from '../models/FileMetadata.js';
import { createFileMetadata } from '../models/FileMetadata.js';
import { getLogger, createChildLogger } from '../lib/logger.js';

export interface FileMonitorEvents {
  fileReady: (metadata: FileMetadata) => void;
  error: (error: Error) => void;
}

export declare interface FileMonitor {
  on<U extends keyof FileMonitorEvents>(
    event: U,
    listener: FileMonitorEvents[U]
  ): this;
  emit<U extends keyof FileMonitorEvents>(
    event: U,
    ...args: Parameters<FileMonitorEvents[U]>
  ): boolean;
}

export class FileMonitor extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private config: MonitoringConfig;
  private logger = getLogger();
  private writeCheckTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: MonitoringConfig) {
    super();
    this.config = config;
  }

  /**
   * Start monitoring the configured directory
   */
  start(): void {
    this.logger.info({ watchPath: this.config.watchPath }, 'Starting file monitor');

    this.watcher = chokidar.watch(this.config.watchPath, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: this.config.ignoreInitial,
      awaitWriteFinish: {
        stabilityThreshold: this.config.stabilityThreshold,
        pollInterval: this.config.pollInterval,
      },
    });

    this.watcher
      .on('add', (path) => this.handleFileDetected(path))
      .on('error', (error) => this.handleError(error as Error))
      .on('ready', () => {
        this.logger.info('File monitor ready');
      });
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping file monitor');

    // Clear all pending write check timers
    for (const timer of this.writeCheckTimers.values()) {
      clearTimeout(timer);
    }
    this.writeCheckTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.logger.info('File monitor stopped');
  }

  /**
   * Handle file detected event
   * @param filePath Absolute file path
   */
  private async handleFileDetected(filePath: string): Promise<void> {
    const logger = createChildLogger({ filePath });

    try {
      logger.info('File detected');

      // Get file stats
      const stats = await stat(filePath);

      // Check if file is still being written
      if (await this.isFileBeingWritten(filePath, stats.size)) {
        logger.debug('File is being written, waiting for completion');
        return;
      }

      // Create metadata
      const relativePath = relative(this.config.watchPath, filePath);
      const extension = extname(filePath);
      const fileType = getFileType(filePath);

      const metadata = createFileMetadata(
        filePath,
        relativePath,
        stats.size,
        fileType,
        extension,
        stats.mtime
      );

      logger.info({ type: fileType, size: stats.size, extension }, 'File ready for processing');

      // Emit event
      this.emit('fileReady', metadata);

    } catch (error) {
      logger.error({ error }, 'Error handling file detection');
      this.emit('error', error as Error);
    }
  }

  /**
   * Check if file is still being written by monitoring size changes
   * @param filePath File path
   * @param currentSize Current file size
   * @returns True if file is being written
   */
  private async isFileBeingWritten(filePath: string, currentSize: number): Promise<boolean> {
    // If there's already a timer for this file, it's still being written
    if (this.writeCheckTimers.has(filePath)) {
      return true;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        try {
          const stats = await stat(filePath);

          if (stats.size === currentSize) {
            // Size hasn't changed, file write complete
            this.writeCheckTimers.delete(filePath);
            resolve(false);

            // Re-trigger file detection now that write is complete
            await this.handleFileDetected(filePath);
          } else {
            // Size changed, still being written
            this.writeCheckTimers.delete(filePath);
            await this.isFileBeingWritten(filePath, stats.size);
            resolve(true);
          }
        } catch (error) {
          this.writeCheckTimers.delete(filePath);
          this.logger.error({ filePath, error }, 'Error checking file write status');
          resolve(false);
        }
      }, this.config.stabilityThreshold);

      this.writeCheckTimers.set(filePath, timer);
    });
  }

  /**
   * Handle error
   * @param error Error object
   */
  private handleError(error: Error): void {
    this.logger.error({ error }, 'File monitor error');
    this.emit('error', error);
  }
}
