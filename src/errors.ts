import type { JobStatus } from './types';

export class MemAuraError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MemAuraValidationError extends MemAuraError {}

export class MemAuraNetworkError extends MemAuraError {}

export class MemAuraTimeoutError extends MemAuraError {
  readonly lastJob?: JobStatus;

  constructor(message: string, options?: ErrorOptions & { lastJob?: JobStatus }) {
    super(message, options);
    this.lastJob = options?.lastJob;
  }
}

export class MemAuraApiError extends MemAuraError {
  readonly status?: number;
  readonly code?: number;
  readonly error?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: ErrorOptions & {
      status?: number;
      code?: number;
      error?: string;
      details?: unknown;
    },
  ) {
    super(message, options);
    this.status = options?.status;
    this.code = options?.code;
    this.error = options?.error;
    this.details = options?.details;
  }
}
