import { describe, it, expect } from '@jest/globals';
import {
  FileType,
  isArchiveFile,
  isDatabaseFile,
  getFileType,
} from '../../src/types/index.js';

describe('Type utilities', () => {
  describe('isArchiveFile', () => {
    it('should identify ZIP files', () => {
      expect(isArchiveFile('test.zip')).toBe(true);
      expect(isArchiveFile('test.ZIP')).toBe(true);
    });

    it('should identify TAR files', () => {
      expect(isArchiveFile('test.tar')).toBe(true);
      expect(isArchiveFile('test.tar.gz')).toBe(true);
      expect(isArchiveFile('test.tgz')).toBe(true);
    });

    it('should not identify non-archive files', () => {
      expect(isArchiveFile('test.txt')).toBe(false);
      expect(isArchiveFile('test.csv')).toBe(false);
    });
  });

  describe('isDatabaseFile', () => {
    it('should identify CSV files', () => {
      expect(isDatabaseFile('test.csv')).toBe(true);
      expect(isDatabaseFile('test.CSV')).toBe(true);
    });

    it('should identify JSON files', () => {
      expect(isDatabaseFile('test.json')).toBe(true);
      expect(isDatabaseFile('test.jsonl')).toBe(true);
    });

    it('should identify XML files', () => {
      expect(isDatabaseFile('test.xml')).toBe(true);
    });

    it('should not identify non-database files', () => {
      expect(isDatabaseFile('test.txt')).toBe(false);
      expect(isDatabaseFile('test.zip')).toBe(false);
    });
  });

  describe('getFileType', () => {
    it('should return ARCHIVE for archive files', () => {
      expect(getFileType('test.zip')).toBe(FileType.ARCHIVE);
      expect(getFileType('test.tar.gz')).toBe(FileType.ARCHIVE);
    });

    it('should return DATABASE for database files', () => {
      expect(getFileType('test.csv')).toBe(FileType.DATABASE);
      expect(getFileType('test.json')).toBe(FileType.DATABASE);
    });

    it('should return REGULAR for other files', () => {
      expect(getFileType('test.txt')).toBe(FileType.REGULAR);
      expect(getFileType('test.pdf')).toBe(FileType.REGULAR);
    });
  });
});
