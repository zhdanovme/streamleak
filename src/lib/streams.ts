import { pipeline, Readable, Writable, Transform } from 'stream';
import { promisify } from 'util';
import { getLogger } from './logger.js';

const pipelineAsync = promisify(pipeline);

/**
 * Pipe streams with proper error handling
 * @param streams Array of streams to pipe together
 * @returns Promise that resolves when pipeline completes
 */
export async function pipeStreams(...streams: (Readable | Writable | Transform)[]): Promise<void> {
  const logger = getLogger();

  try {
    // @ts-ignore - Type mismatch between promisified pipeline and spread array
    await pipelineAsync(...streams);
  } catch (error) {
    logger.error({ error }, 'Stream pipeline error');
    throw error;
  }
}

/**
 * Create a transform stream that tracks progress
 * @param onProgress Callback function called with number of bytes processed
 * @returns Transform stream that passes data through while tracking progress
 */
export function createProgressTracker(
  onProgress: (bytes: number) => void
): Transform {
  let totalBytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.length;
      onProgress(totalBytes);
      callback(null, chunk);
    },
  });
}

/**
 * Convert a buffer or string to a readable stream
 * @param data Buffer or string to convert
 * @returns Readable stream
 */
export function bufferToStream(data: Buffer | string): Readable {
  return Readable.from(Buffer.isBuffer(data) ? [data] : [Buffer.from(data)]);
}

/**
 * Read entire stream into a buffer
 * @param stream Readable stream
 * @returns Promise that resolves with complete buffer
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Create a pass-through stream that logs data flow
 * @param label Label for logging
 * @returns Transform stream that logs data
 */
export function createLoggingStream(label: string): Transform {
  const logger = getLogger();
  let bytesProcessed = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesProcessed += chunk.length;
      logger.debug({ label, bytes: chunk.length, total: bytesProcessed }, 'Stream data');
      callback(null, chunk);
    },
    flush(callback) {
      logger.debug({ label, totalBytes: bytesProcessed }, 'Stream complete');
      callback();
    },
  });
}
