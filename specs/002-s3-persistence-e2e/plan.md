# Implementation Plan: End-to-End Docker S3 Persistence Test

**Branch**: `002-s3-persistence-e2e` | **Date**: 2025-11-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-s3-persistence-e2e/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature implements a comprehensive end-to-end integration test suite that validates the entire file processing pipeline: Docker-based S3 environment setup, mock data generation, file tracking and migration to S3 with parquet conversion, script restart/resume capability, and state persistence verification. The test simulates production scenarios including graceful interruption and continuation of work, ensuring the system correctly handles both successful and failed file processing while maintaining accurate state across restarts.

## Technical Context

**Language/Version**: TypeScript 5.9+ with Node.js 20+
**Primary Dependencies**: Jest 30.x (testing), @aws-sdk/client-s3 3.x (S3 operations), better-sqlite3 12.x (state persistence), duckdb 1.4+ (parquet operations), tar-stream 3.x/unzipper 0.12 (archive handling), dockerode (Docker API)
**Storage**: Better-sqlite3 for state tracking database, S3 (MinIO) for parquet file storage
**Testing**: Jest with integration test support, testcontainers-node for Docker management
**Target Platform**: Node.js 20+ server environment (Linux/macOS/Windows with Docker)
**Project Type**: Single project (backend service with CLI)
**Performance Goals**: Complete full E2E test suite in under 5 minutes, environment setup in under 30 seconds
**Constraints**: Requires Docker daemon running, minimum 1GB disk space for test data, S3 endpoint must respond within 5 seconds
**Scale/Scope**: Test suite with 10-15 test files, 4 major test scenarios (setup, migration, restart, validation), complete teardown/cleanup

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: ✅ PASS (No constitution defined - default pass)

The project constitution file exists but is not yet filled out with specific principles. This feature proceeds with industry-standard best practices:

- **Testing approach**: E2E integration tests follow standard Docker Compose + Jest pattern
- **Isolation**: Tests use isolated Docker containers to avoid conflicts
- **Cleanup**: Proper teardown ensures no resource leaks
- **State management**: SQLite-based state tracking is standard for this use case

Once the constitution is ratified, this section will be updated to verify compliance with project-specific principles (e.g., library-first, CLI interface, test-first mandates).

## Project Structure

### Documentation (this feature)

```text
specs/002-s3-persistence-e2e/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── test-expectations.yaml  # Expected test outcomes and assertions
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Existing structure (to be extended)
src/
├── models/              # Existing: FileMetadata, ProcessingJob, ProgressRecord, S3UploadTask
├── services/            # Existing: FileProcessor, S3Uploader, ParquetConverter, ArchiveExtractor, FileMonitor, ProgressTracker
├── lib/                 # Existing: logger, streams, checksum
├── config/              # Existing: config
├── types/               # Existing: index
└── index.ts             # Existing: main entry point

# New test structure (to be created)
tests/
├── e2e/
│   ├── setup/
│   │   ├── docker-environment.test.ts      # P1: Docker + S3 + test data setup
│   │   ├── mock-data-generator.ts          # Helper: creates test files
│   │   └── test-fixtures.ts                # Helper: fixture definitions
│   ├── scenarios/
│   │   ├── file-tracking-migration.test.ts # P2: Track + convert + upload validation
│   │   ├── script-restart-resume.test.ts   # P3: Interrupt + restart + verify
│   │   └── state-validation.test.ts        # P4: Failed/done/pending file states
│   └── helpers/
│       ├── docker-manager.ts               # Helper: Docker lifecycle management
│       ├── s3-test-client.ts               # Helper: S3 test operations
│       └── process-controller.ts           # Helper: Script start/stop/restart

# Test configuration
tests/
├── setup.ts             # Jest global setup (Docker initialization)
├── teardown.ts          # Jest global teardown (cleanup)
└── test-utils.ts        # Shared test utilities

# Docker test environment
docker/
└── test/
    ├── docker-compose.test.yml  # Test-specific Docker Compose (MinIO S3)
    └── .env.test                # Test environment variables
```

**Structure Decision**: Single project structure with dedicated `tests/` directory for E2E integration tests. Tests are organized by priority (P1-P4 user stories) and separated into setup, scenarios, and helpers. The existing `src/` structure remains unchanged - tests validate existing services and models. Docker configuration is isolated in `docker/test/` to avoid conflicts with development environment.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

N/A - No constitution violations. Standard E2E testing approach aligns with common practices.
