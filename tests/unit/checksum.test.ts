import { describe, it, expect } from '@jest/globals';
import { calculateBufferChecksum } from '../../src/lib/checksum.js';

describe('Checksum utilities', () => {
  describe('calculateBufferChecksum', () => {
    it('should calculate SHA256 checksum for buffer', () => {
      const buffer = Buffer.from('test content');
      const checksum = calculateBufferChecksum(buffer);

      expect(checksum).toBeDefined();
      expect(checksum).toHaveLength(64); // SHA256 hex is 64 characters
      expect(checksum).toMatch(/^[a-f0-9]{64}$/); // Should be lowercase hex
    });

    it('should produce consistent checksums for same content', () => {
      const buffer1 = Buffer.from('test content');
      const buffer2 = Buffer.from('test content');

      const checksum1 = calculateBufferChecksum(buffer1);
      const checksum2 = calculateBufferChecksum(buffer2);

      expect(checksum1).toBe(checksum2);
    });

    it('should produce different checksums for different content', () => {
      const buffer1 = Buffer.from('test content 1');
      const buffer2 = Buffer.from('test content 2');

      const checksum1 = calculateBufferChecksum(buffer1);
      const checksum2 = calculateBufferChecksum(buffer2);

      expect(checksum1).not.toBe(checksum2);
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.from('');
      const checksum = calculateBufferChecksum(buffer);

      expect(checksum).toBeDefined();
      expect(checksum).toHaveLength(64);
    });
  });
});
