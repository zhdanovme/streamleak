import { randomUUID } from 'crypto';
import { ProcessingStatus, ProcessingStep } from '../types/index.js';
import type { FileMetadata } from './FileMetadata.js';

export interface ProcessingJob {
  /** UUID for this processing job */
  id: string;

  /** The file being processed */
  file: FileMetadata;

  /** Current status */
  status: ProcessingStatus;

  /** Steps completed so far */
  steps: ProcessingStep[];

  /** Currently executing step */
  currentStep: ProcessingStep | null;

  /** Number of retry attempts */
  retryCount: number;

  /** When processing started */
  startTime: Date;

  /** When processing completed/failed */
  endTime: Date | null;

  /** Error if processing failed */
  error: Error | null;
}

export function createProcessingJob(file: FileMetadata): ProcessingJob {
  return {
    id: randomUUID(),
    file,
    status: ProcessingStatus.PENDING,
    steps: [],
    currentStep: null,
    retryCount: 0,
    startTime: new Date(),
    endTime: null,
    error: null,
  };
}

export function markStepComplete(job: ProcessingJob, step: ProcessingStep): void {
  if (job.currentStep === step) {
    job.steps.push(step);
    job.currentStep = null;
  }
}

export function markStepStarted(job: ProcessingJob, step: ProcessingStep): void {
  job.currentStep = step;
}

export function markJobComplete(job: ProcessingJob): void {
  job.status = ProcessingStatus.COMPLETED;
  job.endTime = new Date();
  job.currentStep = null;
}

export function markJobFailed(job: ProcessingJob, error: Error): void {
  job.status = ProcessingStatus.FAILED;
  job.error = error;
  job.endTime = new Date();
  job.currentStep = null;
}
