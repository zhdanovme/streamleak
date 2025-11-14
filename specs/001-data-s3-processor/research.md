# Technical Research: Data File Processor

## 1. S3 Upload Library

**Decision**: `@aws-sdk/client-s3` (v3) with `@aws-sdk/lib-storage`

**Rationale**:
- **Official AWS SDK**: The v3 SDK is the current official AWS SDK for JavaScript/TypeScript with full TypeScript support and type definitions
- **Streaming multipart uploads**: The `@aws-sdk/lib-storage` package provides the `Upload` class that handles streaming uploads with automatic multipart upload management
- **Feature complete**: Supports all required features including metadata, checksums (SHA256, CRC32, CRC32C, SHA1), and concurrent part uploads
- **Configurable concurrency**: Allows configuration of `partSize` and `queueSize` for optimal performance
- **S3-compatible storage support**: Works with both AWS S3 and S3-compatible services like MinIO by setting custom endpoints with `forcePathStyle: true`
- **Active maintenance**: Part of the official AWS SDK, continuously updated and supported

**Key Configuration**:
```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const upload = new Upload({
  client: s3Client,
  params: {
    Bucket: 'bucket-name',
    Key: 'file-key',
    Body: readableStream,
    Metadata: { /* custom metadata */ },
    ChecksumAlgorithm: 'SHA256'
  },
  partSize: 8 * 1024 * 1024, // 8MB
  queueSize: 4
});
```

**Alternatives Considered**:
- **minio client** (`minio` npm package): Provides MinIO-specific optimizations and simpler API. However, using AWS SDK provides better portability between AWS S3 and S3-compatible storage, allowing code reuse if migrating between services. The MinIO client would lock you into MinIO-specific patterns.
- **s3-upload-stream**: Older library designed for AWS SDK v2, not maintained for v3. The `@aws-sdk/lib-storage` package is the official replacement.

**Gotchas**:
- The `Upload` class from `@aws-sdk/lib-storage` is a separate package and must be installed alongside `@aws-sdk/client-s3`
- When using multipart uploads with checksums, there's a known issue where the complete request must include checksums for each part (as of late 2024)
- Memory management: Monitor memory usage when doing bulk uploads; some users have reported memory issues with v3 SDK

---

## 2. Database to Parquet Conversion

**Decision**: `duckdb` (v1.1.3+)

**Rationale**:
- **All-in-one solution**: DuckDB natively reads CSV, JSON, XML and writes Parquet - no need for separate parsing + conversion libraries
- **Built-in compression**: Native support for Snappy, ZSTD, Gzip, and uncompressed Parquet
- **Automatic type inference**: Intelligently detects data types from CSV/JSON without manual schema definition
- **Streaming support**: Can process files larger than RAM using streaming queries
- **SQL interface**: Simple, powerful SQL for data transformation during conversion
- **Zero-copy reads**: Efficient memory usage when reading and converting data
- **Production-proven**: Used in data pipelines handling terabytes of data
- **TypeScript bindings**: Official `duckdb` npm package with TypeScript support

**Example conversions**:
```typescript
import Database from 'duckdb';

const db = new Database(':memory:');
const conn = db.connect();

// CSV to Parquet with ZSTD compression
conn.run(`
  COPY (SELECT * FROM read_csv_auto('input.csv'))
  TO 'output.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
`);

// JSON to Parquet
conn.run(`
  COPY (SELECT * FROM read_json_auto('input.json'))
  TO 'output.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
`);

// XML to Parquet (requires extension)
conn.run(`
  INSTALL spatial;
  LOAD spatial;
  COPY (SELECT * FROM ST_Read('input.xml'))
  TO 'output.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
`);
```

**Streaming for large files**:
```typescript
// Process file in chunks to avoid loading into memory
conn.run(`
  COPY (
    SELECT * FROM read_csv_auto('large.csv', sample_size=10000)
  ) TO 'output.parquet' (
    FORMAT PARQUET,
    COMPRESSION ZSTD,
    ROW_GROUP_SIZE 100000
  );
`);
```

**Alternatives Considered**:
- **parquet-wasm**: WASM-based Parquet writer with good performance. However, requires separate CSV/JSON parsing libraries (Papa Parse, etc.), manual data type handling, and Apache Arrow integration. More complex pipeline compared to DuckDB's all-in-one approach.
- **@dsnp/parquetjs + csv-parser**: Pure JavaScript approach with separate libraries for parsing and Parquet writing. Slower than DuckDB, requires manual type inference, and more complex to integrate.
- **apache-arrow-js + parquet-wasm**: High-performance option but requires converting data through Arrow format, adding complexity and memory overhead.

**Gotchas**:
- DuckDB creates databases in-memory or on disk; use `:memory:` for temporary conversions
- Extension installation (for XML) requires network access on first run
- Large files may still require disk space for temporary storage during conversion (though much less than raw file size)
- The Node.js binding is a native addon requiring compilation on installation
- For true streaming without any disk usage, you may need to pipe data through DuckDB's streaming API rather than using files

---

## 3. Archive Extraction Library

**Decision**: Multiple libraries based on format
- **ZIP**: `unzipper` (v0.10.x+)
- **TAR/GZ**: `tar-stream` (v3.x+)
- **BZ2/XZ**: `decompress` with plugins
- **7Z**: Not streaming-capable; recommend rejecting 7Z or using `node-7z` with temp files

**Rationale**:

### For ZIP (`unzipper`):
- **Streaming architecture**: Built on a new streaming engine that processes files without hitting the filesystem
- **No compiled dependencies**: Uses Node.js built-in zlib, avoiding native compilation issues
- **Memory efficient**: Can process large archives without loading entire contents into memory
- **Promise and stream APIs**: Provides both Promise-based and stream-based APIs
- **Random access support**: Can open and extract specific files from archives
- **TypeScript support**: Type definitions available via `@types/unzipper`

```typescript
import unzipper from 'unzipper';
import { createReadStream } from 'fs';

createReadStream('archive.zip')
  .pipe(unzipper.Parse())
  .on('entry', (entry) => {
    const fileName = entry.path;
    const type = entry.type; // 'Directory' or 'File'

    if (type === 'File') {
      entry.pipe(/* process stream */);
    } else {
      entry.autodrain();
    }
  });
```

### For TAR/GZ (`tar-stream`):
- **Pure streaming**: Operates purely using streams with no filesystem access required
- **Lightweight**: Minimal dependencies, focused implementation
- **Extraction and creation**: Supports both reading and creating tar archives
- **Gzip integration**: Works seamlessly with Node.js zlib for .tar.gz files

```typescript
import tar from 'tar-stream';
import { createGunzip } from 'zlib';
import { createReadStream } from 'fs';

const extract = tar.extract();
extract.on('entry', (header, stream, next) => {
  stream.on('end', () => next());
  stream.pipe(/* process stream */);
});

createReadStream('archive.tar.gz')
  .pipe(createGunzip())
  .pipe(extract);
```

### For 7Z (7-Zip format):
- **No pure JavaScript streaming solution**: The 7z compression algorithm is complex and doesn't have a reliable streaming implementation in JavaScript
- **node-7z**: Wrapper around 7-Zip CLI that provides some streaming through child processes, but still requires 7-Zip binary installation
- **Recommendation**: Either reject 7Z files in your requirements OR accept that they require temp file extraction using `node-7z` or `7zip-min`

**Alternatives Considered**:
- **decompress**: Plugin-based archive extraction with support for multiple formats. However, it doesn't provide true streaming for all formats and tends to buffer more data in memory. Better suited for small archives where memory isn't a concern. Can be used as a fallback for BZ2/XZ formats.
- **unzip-stream**: Earlier version of the streaming unzip implementation; `unzipper` is the improved successor with better error handling.
- **tar-vern**: Modern TypeScript-native tar library with good API, but less battle-tested than tar-stream.
- **node-7z**: Requires 7-Zip binary installation on the system; not a pure Node.js solution. Provides progress events but doesn't eliminate disk I/O.

**Gotchas**:
- Different archive formats require different libraries; you'll need multiple dependencies
- ZIP streaming requires careful handling of the `entry` event to avoid memory issues; must call `autodrain()` on entries you don't process
- 7Z cannot be processed in a truly streaming fashion with pure JavaScript; requires either rejecting this format or accepting temporary file extraction
- BZ2 and XZ formats have limited streaming support; may need to use decompress with buffering
- TAR files don't have a central directory like ZIP, so you must process entries sequentially

---

## 4. File Monitoring Library

**Decision**: `chokidar` (v4.x)

**Rationale**:
- **Native TypeScript**: Version 4 (released September 2024) is rewritten in TypeScript, providing first-class TypeScript support
- **Cross-platform**: Uses native OS file watching APIs (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows)
- **High performance**: Handles thousands of files with minimal CPU overhead by using native file system events instead of polling
- **Write completion detection**: Built-in `awaitWriteFinish` option that polls file size to detect when files are completely written
- **Battle-tested**: Used in ~30 million repositories, proven in production at scale (created 2012, actively maintained)
- **Minimal dependencies**: Version 4 reduced dependency count from 13 to 1
- **Rich event API**: Supports `add`, `addDir`, `change`, `unlink`, `unlinkDir`, `ready`, and `error` events

**Configuration for detecting write completion**:
```typescript
import chokidar from 'chokidar';

const watcher = chokidar.watch('/path/to/folder', {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000, // wait 2s for file size to stabilize
    pollInterval: 100 // check every 100ms
  }
});

watcher
  .on('add', path => console.log(`File ${path} has been added`))
  .on('change', path => console.log(`File ${path} has been changed`))
  .on('ready', () => console.log('Initial scan complete. Ready for changes'));
```

**Alternatives Considered**:
- **node-watch**: Lightweight alternative suitable for simple use cases. However, it may rely on polling in some scenarios, making it less efficient for large numbers of files. Lacks the advanced features like `awaitWriteFinish` that are critical for detecting write completion. Better suited for monitoring a few files in simple scripts.
- **fs.watch** (Node.js built-in): Low-level API that requires manual handling of many edge cases. Some discussion in the Vite project about using native fs.watch for Node.js >= v19.1, but chokidar still provides better cross-platform consistency and developer experience.
- **watchpack**: Used internally by webpack, optimized for build tools but more complex than needed for this use case.

**Gotchas**:
- The `awaitWriteFinish` option adds latency (default 2 seconds) before firing events, which is necessary to ensure files are completely written but may slow down processing
- Must handle the `ready` event to distinguish between initial scan and new file additions
- On macOS, watching large numbers of files may hit system limits for file descriptors
- Version 4 removed glob support and bundled fsevents, which may break existing code if migrating from v3

---

## 5. Progress Tracking Storage

**Decision**: `better-sqlite3` (v12.4.1+)

**Rationale**:
- **ACID compliance**: Full ACID transaction support with atomic, consistent, isolated, and durable transactions even during crashes or power failures
- **Performance**: Significantly faster than node-sqlite3, handles thousands of records with <1ms lookups when properly indexed
- **WAL mode support**: Write-Ahead Logging mode enables concurrent reads during writes, preventing corruption and improving performance
- **Synchronous API**: Simpler programming model for progress tracking without callback/promise overhead
- **TypeScript support**: Full type definitions included via `@types/better-sqlite3`
- **Zero dependencies**: Native addon with no runtime dependencies (aside from native compilation)
- **Compact storage**: SQLite is extremely efficient for small databases (<1MB for thousands of progress records)
- **Built-in backup**: Progress tracking can be backed up with simple file copy (when using WAL mode correctly)

**Recommended schema for progress tracking**:
```typescript
import Database from 'better-sqlite3';

const db = new Database('progress.db');
db.pragma('journal_mode = WAL'); // Enable WAL mode for safety and performance

// Create schema with index on file_path for fast lookups
db.exec(`
  CREATE TABLE IF NOT EXISTS file_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    size_bytes INTEGER,
    processed_bytes INTEGER,
    checksum TEXT,
    s3_key TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_file_path ON file_progress(file_path);
  CREATE INDEX IF NOT EXISTS idx_status ON file_progress(status);
`);

// Prepared statements for fast operations
const insert = db.prepare(`
  INSERT INTO file_progress (file_path, status, created_at, updated_at)
  VALUES (?, ?, ?, ?)
`);

const update = db.prepare(`
  UPDATE file_progress
  SET status = ?, processed_bytes = ?, updated_at = ?
  WHERE file_path = ?
`);

const lookup = db.prepare('SELECT * FROM file_progress WHERE file_path = ?');
```

**Alternatives Considered**:
- **lowdb**: Lightweight JSON file database that's simple to use but lacks ACID guarantees, has corruption risks under concurrent access, and is not recommended for production use. Performance degrades significantly with thousands of records since it loads the entire JSON file into memory. Better suited for configuration files or development prototyping.
- **JSON files with atomic writes**: Could implement custom atomic write logic using `fs.writeFileSync` with temp files and renames. However, this requires manual implementation of locking, indexing, and transaction semantics. More error-prone and slower than SQLite for lookups.
- **NeDB/LokiDB**: In-memory JavaScript databases with persistence. Both have concerns about data corruption and ACID compliance. NeDB is no longer actively maintained.

**Gotchas**:
- Must enable WAL mode explicitly with `db.pragma('journal_mode = WAL')` for optimal performance and safety
- WAL mode creates additional files (.db-wal, .db-shm) that must be kept with the database file
- Better-sqlite3 is a native addon requiring compilation; may need node-gyp setup in some environments
- Need proper indexes on lookup columns (especially file_path) or performance will degrade with scale
- WAL file can grow large if writes are frequent without checkpoints; SQLite usually handles this automatically with `wal_autocheckpoint`, but long-running write transactions can prevent checkpointing
- The synchronous API blocks the event loop; for thousands of rapid operations, consider batching with transactions

---

## 6. Logging Library

**Decision**: `pino` (v9.x+)

**Rationale**:
- **Performance leader**: 5-10x faster than Winston, handles 10,000+ logs/second with minimal overhead
- **Asynchronous architecture**: Separates log writing from formatting, using worker threads to avoid blocking the main thread
- **Structured logging**: Native JSON output perfect for log aggregation systems (ELK, Splunk, CloudWatch)
- **Human-readable development mode**: `pino-pretty` transport provides colorized, formatted output during development
- **TypeScript support**: Full TypeScript definitions and types included
- **Low overhead**: Minimal CPU and memory footprint makes it ideal for high-performance applications
- **Standard log levels**: Supports trace, debug, info, warn, error, fatal
- **Child loggers**: Create contextual child loggers with bound properties
- **Production proven**: Used in high-throughput production systems

**Configuration for development and production**:
```typescript
import pino from 'pino';

// Environment-based configuration
const logger = pino(
  process.env.NODE_ENV === 'production'
    ? {
        level: 'info'
      }
    : {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
          }
        }
      }
);

// Usage with structured data
logger.info({ filePath: '/path/to/file', size: 1024 }, 'Processing file');
logger.error({ err: new Error('Failed') }, 'Upload failed');

// Child logger with context
const fileLogger = logger.child({ component: 'file-processor' });
```

**Alternatives Considered**:
- **winston**: Most popular Node.js logger with extensive features, multiple transport support, and highly customizable. However, it has significantly more overhead than Pino (5-10x slower) due to synchronous processing on the main thread. Better suited when you need extensive custom transports or complex log routing, but overkill for this console application.
- **bunyan**: Structured JSON logging library with moderate performance. Uses synchronous logging model that blocks the main thread, making it slower than Pino for high-volume logging. Has fallen behind in maintenance compared to Pino and Winston. Simpler API than Winston but lacks the performance of Pino.

**Gotchas**:
- `pino-pretty` should be a dev dependency only; don't use it in production as it negates Pino's performance benefits
- JSON output in production requires log viewing tools or piping to `pino-pretty`: `node app.js | pino-pretty`
- The asynchronous nature means logs might not be flushed if the process crashes immediately; use `pino.final()` for critical shutdown logging
- Error objects need to be passed in the data object with key `err` to be serialized properly: `logger.error({ err }, 'message')`
- Child loggers inherit parent properties; be careful not to accumulate too many bound properties in long-lived child loggers

---

## Summary Matrix

| Requirement | Library | Version | Key Feature | Notable Limitation |
|-------------|---------|---------|-------------|-------------------|
| S3 Upload | @aws-sdk/client-s3 + @aws-sdk/lib-storage | v3 | Streaming multipart, official AWS SDK | Separate package for Upload class |
| Parquet Conversion | duckdb | v1.1.3+ | All-in-one CSV/JSON/XML → Parquet | Native addon requires compilation |
| ZIP | unzipper | v0.10.x+ | Streaming, no native deps | Must handle entry draining |
| TAR/GZ | tar-stream | v3.x+ | Pure streaming, lightweight | Sequential processing only |
| 7Z | N/A - Reject or node-7z | - | - | No true streaming solution |
| File Watch | chokidar | v4.x | Native TS, awaitWriteFinish | Adds latency for write detection |
| Progress DB | better-sqlite3 | v12.4.1+ | ACID, fast, WAL mode | Native addon requires compilation |
| Logging | pino | v9.x+ | 5-10x faster, async | JSON output requires pretty-print in dev |

---

## Installation Commands

```bash
# S3 Upload
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage

# Database to Parquet Conversion
npm install duckdb

# Archive Extraction
npm install unzipper tar-stream
npm install decompress  # For BZ2/XZ if needed

# File Monitoring
npm install chokidar

# Progress Storage
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3

# Logging
npm install pino
npm install --save-dev pino-pretty

# Optional: TypeScript types where not included
npm install --save-dev @types/unzipper
```

---

## Additional Recommendations

1. **Error Handling**: Implement retry logic for S3 uploads using exponential backoff
2. **Memory Management**: Use streaming throughout the pipeline to avoid loading large files into memory
3. **Progress Persistence**: Wrap database updates in transactions for atomic progress tracking
4. **Logging Strategy**: Use structured logging with correlation IDs to trace file processing through the pipeline
5. **Compression Selection**: Use ZSTD for better compression ratios (slower) or Snappy for faster processing with moderate compression
6. **Testing**: Consider using MinIO locally for S3-compatible testing before deploying to AWS
