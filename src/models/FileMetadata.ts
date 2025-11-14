import { FileType } from '../types/index.js';

export interface FileMetadata {
  /** Absolute file path */
  path: string;

  /** Path relative to monitored directory */
  relativePath: string;

  /** File size in bytes */
  size: number;

  /** File type classification */
  type: FileType;

  /** File extension (e.g., '.csv', '.zip') */
  extension: string;

  /** SHA256 hash of file contents (calculated lazily) */
  checksum?: string;

  /** Last modification timestamp */
  modifiedAt: Date;

  /** When file was detected by monitor */
  detectedAt: Date;
}

export function createFileMetadata(
  path: string,
  relativePath: string,
  size: number,
  type: FileType,
  extension: string,
  modifiedAt: Date
): FileMetadata {
  return {
    path,
    relativePath,
    size,
    type,
    extension,
    modifiedAt,
    detectedAt: new Date(),
  };
}
