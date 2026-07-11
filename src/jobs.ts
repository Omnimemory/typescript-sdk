import { MemAuraNetworkError, MemAuraTimeoutError, MemAuraValidationError } from './errors';
import type { JobLookupOptions, JobStatus, WaitForJobOptions } from './types';

const terminalStatuses = new Set([
  'canceled',
  'cancelled',
  'completed',
  'done',
  'error',
  'failed',
  'success',
  'succeeded',
]);

type GetJob = (
  jobId: string,
  options?: JobLookupOptions,
  requestTimeoutMs?: number,
) => Promise<JobStatus>;

const sleep = (delayMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new MemAuraNetworkError('Job wait was aborted'));
      return;
    }

    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new MemAuraNetworkError('Job wait was aborted'));
      },
      { once: true },
    );
  });

export class JobOperations {
  constructor(private readonly getJobStatus: GetJob) {}

  get(jobId: string, options?: JobLookupOptions): Promise<JobStatus> {
    if (!jobId.trim()) {
      throw new MemAuraValidationError('jobId must not be empty');
    }
    return this.getJobStatus(jobId, options);
  }

  async wait(jobId: string, options: WaitForJobOptions = {}): Promise<JobStatus> {
    if (!jobId.trim()) {
      throw new MemAuraValidationError('jobId must not be empty');
    }

    const intervalMs = options.intervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new MemAuraValidationError('intervalMs must be greater than zero');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new MemAuraValidationError('timeoutMs must be greater than zero');
    }

    const deadline = Date.now() + timeoutMs;
    let lastJob: JobStatus | undefined;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) {
        throw new MemAuraNetworkError('Job wait was aborted');
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      try {
        lastJob = await this.getJobStatus(jobId, options, remainingMs);
      } catch (error) {
        if (error instanceof MemAuraTimeoutError) {
          throw new MemAuraTimeoutError(`Timed out waiting for ingest job ${jobId}`, {
            cause: error,
            lastJob,
          });
        }
        throw error;
      }
      if (lastJob.status && terminalStatuses.has(lastJob.status.toLowerCase())) {
        return lastJob;
      }

      const nextRemainingMs = deadline - Date.now();
      if (nextRemainingMs <= 0) {
        break;
      }
      await sleep(Math.min(intervalMs, nextRemainingMs), options.signal);
    }

    throw new MemAuraTimeoutError(`Timed out waiting for ingest job ${jobId}`, { lastJob });
  }
}
