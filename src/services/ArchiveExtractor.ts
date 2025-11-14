import { createReadStream } from 'fs';
import { Readable } from 'stream';
import * as unzipper from 'unzipper';
import * as tar from 'tar-stream';
import { createGunzip, createBrotliDecompress } from 'zlib';
import { createChildLogger } from '../lib/logger.js';

export interface ArchiveEntry {
  /** Entry path within archive */
  path: string;

  /** Readable stream of entry content */
  stream: Readable;

  /** Entry size in bytes (if known) */
  size?: number;

  /** Whether this is a directory */
  isDirectory: boolean;
}

export class ArchiveExtractor {
  /**
   * Detect archive type from file extension
   * @param filePath File path
   * @returns Archive type or null if not recognized
   */
  private detectArchiveType(filePath: string): 'zip' | 'tar' | 'tar.gz' | 'tgz' | 'tar.bz2' | 'tar.xz' | null {
    const lower = filePath.toLowerCase();

    if (lower.endsWith('.zip')) {
      return 'zip';
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      return 'tar.gz';
    } else if (lower.endsWith('.tar.bz2')) {
      return 'tar.bz2';
    } else if (lower.endsWith('.tar.xz')) {
      return 'tar.xz';
    } else if (lower.endsWith('.tar')) {
      return 'tar';
    } else if (lower.endsWith('.gz')) {
      // Treat standalone .gz as tar.gz
      return 'tar.gz';
    }

    return null;
  }

  /**
   * Extract ZIP archive and yield entries
   * @param filePath Archive file path
   * @yields Archive entries
   */
  async *extractZip(filePath: string): AsyncGenerator<ArchiveEntry> {
    const logger = createChildLogger({ filePath, archiveType: 'zip' });
    logger.info('Extracting ZIP archive');

    const stream = createReadStream(filePath);
    const directory = stream.pipe(unzipper.Parse({ forceStream: true }));

    let entryCount = 0;

    for await (const entry of directory) {
      const typedEntry = entry as unzipper.Entry;

      if (typedEntry.type === 'Directory') {
        typedEntry.autodrain();
        continue;
      }

      entryCount++;
      logger.debug({ path: typedEntry.path }, 'Extracting ZIP entry');

      yield {
        path: typedEntry.path,
        stream: typedEntry,
        size: typedEntry.vars?.compressedSize,
        isDirectory: false,
      };
    }

    logger.info({ entryCount }, 'ZIP extraction complete');
  }

  /**
   * Extract TAR archive and yield entries
   * @param filePath Archive file path
   * @param compressed Compression type (null, 'gzip', 'bzip2', 'xz')
   * @yields Archive entries
   */
  async *extractTar(
    filePath: string,
    compressed: 'gzip' | 'bzip2' | 'xz' | null = null
  ): AsyncGenerator<ArchiveEntry> {
    const logger = createChildLogger({ filePath, archiveType: 'tar', compressed });
    logger.info('Extracting TAR archive');

    let sourceStream: Readable = createReadStream(filePath);

    // Apply decompression if needed
    if (compressed === 'gzip') {
      sourceStream = sourceStream.pipe(createGunzip());
    } else if (compressed === 'bzip2') {
      sourceStream = sourceStream.pipe(createBrotliDecompress());
    } else if (compressed === 'xz') {
      // xz compression not natively supported in Node.js
      throw new Error('XZ compression not supported');
    }

    const extract = tar.extract();
    let entryCount = 0;

    new Promise<void>((resolve, reject) => {
      extract.on('entry', async (header: tar.Headers, stream: Readable, next: () => void) => {
        if (header.type === 'directory') {
          stream.resume(); // Drain directory entries
          next();
          return;
        }

        entryCount++;
        logger.debug({ path: header.name }, 'Extracting TAR entry');

        // We cannot directly yield from inside the event handler,
        // so we'll collect entries and yield them
        const chunks: Buffer[] = [];

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          // Create readable stream from collected chunks
          Readable.from(Buffer.concat(chunks));
          next();
        });

        stream.on('error', (error: Error) => {
          logger.error({ error, path: header.name }, 'Error reading TAR entry');
          next();
        });
      });

      extract.on('finish', () => {
        logger.info({ entryCount }, 'TAR extraction complete');
        resolve();
      });

      extract.on('error', (error: Error) => {
        logger.error({ error }, 'TAR extraction error');
        reject(error);
      });
    });

    // Pipe source to extract
    sourceStream.pipe(extract);

    // Note: This implementation has a limitation - we can't easily yield entries
    // from the event-based TAR API in an async generator.
    // For a complete implementation, we would need to refactor this to use a different approach.

    // For now, we'll throw an error indicating TAR extraction needs refactoring
    throw new Error('TAR extraction via async generator not yet fully implemented. Use extractArchiveToDirectory instead.');
  }

  /**
   * Extract archive and yield all entries
   * @param filePath Archive file path
   * @yields Archive entries
   */
  async *extractArchive(filePath: string): AsyncGenerator<ArchiveEntry> {
    const archiveType = this.detectArchiveType(filePath);

    if (!archiveType) {
      throw new Error(`Unsupported archive type: ${filePath}`);
    }

    switch (archiveType) {
      case 'zip':
        yield* this.extractZip(filePath);
        break;

      case 'tar':
        yield* this.extractTar(filePath, null);
        break;

      case 'tar.gz':
      case 'tgz':
        yield* this.extractTar(filePath, 'gzip');
        break;

      case 'tar.bz2':
        yield* this.extractTar(filePath, 'bzip2');
        break;

      case 'tar.xz':
        yield* this.extractTar(filePath, 'xz');
        break;

      default:
        throw new Error(`Unsupported archive type: ${archiveType}`);
    }
  }

  /**
   * Check if file is a nested archive
   * @param path File path
   * @returns True if file is an archive
   */
  isArchive(path: string): boolean {
    const archiveType = this.detectArchiveType(path);
    return archiveType !== null;
  }
}
