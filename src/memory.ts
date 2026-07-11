import { createClient, type Client } from './generated/client';
import {
  ingestJobStatusMemoryIngestJobsJobIdGet,
  memoryHybridRetrievalMemoryRetrievalHybridPost,
  memoryIngestMemoryIngestPost,
  memoryRetrievalMemoryRetrievalPost,
} from './generated/sdk.gen';
import type { EvidenceDetailOut, IngestJobAck, IngestJobStatus, MemoryRetrievalOut } from './generated/types.gen';
import { MemAuraApiError, MemAuraNetworkError, MemAuraTimeoutError, MemAuraValidationError } from './errors';
import { JobOperations } from './jobs';
import type {
  AddInput,
  AddResult,
  EvidenceDetail,
  JobLookupOptions,
  JobStatus,
  MemoryOptions,
  SearchInput,
  SearchResult,
} from './types';

const defaultEndpoint = 'https://api.omnimemory.cn/api/v2';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  code?: number;
  data?: T | null;
};

type GeneratedResult<T> = {
  data?: Envelope<T>;
  error?: unknown;
  response?: Response;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const normalizeEndpoint = (endpoint: string): string => {
  try {
    return new URL(endpoint).toString().replace(/\/+$/, '');
  } catch {
    throw new MemAuraValidationError('endpoint must be an absolute URL');
  }
};

const validateNonEmpty = (value: string, name: string): void => {
  if (!value.trim()) {
    throw new MemAuraValidationError(`${name} must not be empty`);
  }
};

const mapEvidenceDetail = (detail: EvidenceDetailOut): EvidenceDetail => {
  const mapped: EvidenceDetail = { eventId: detail.event_id, text: detail.text };
  if (detail.source !== undefined) mapped.source = detail.source;
  if (detail.role !== undefined) mapped.role = detail.role;
  if (detail.sender_name !== undefined) mapped.senderName = detail.sender_name;
  if (detail.atomic_facts !== undefined) mapped.atomicFacts = detail.atomic_facts;
  if (detail.group_id !== undefined) mapped.groupId = detail.group_id;
  if (detail.timestamp !== undefined) mapped.timestamp = detail.timestamp;
  return mapped;
};

export class Memory {
  readonly jobs: JobOperations;

  private readonly apiKey: string;
  private readonly client: Client;
  private readonly deviceNo?: string;
  private readonly timeoutMs: number;

  constructor(options: MemoryOptions) {
    validateNonEmpty(options.apiKey, 'apiKey');
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new MemAuraValidationError('timeoutMs must be greater than zero');
    }

    this.apiKey = options.apiKey;
    this.deviceNo = options.deviceNo;
    this.timeoutMs = timeoutMs;
    this.client = createClient({
      baseUrl: normalizeEndpoint(options.endpoint ?? defaultEndpoint),
      headers: { 'X-API-Key': this.apiKey },
    });
    this.jobs = new JobOperations(this.getJob);
  }

  async add(input: AddInput): Promise<AddResult> {
    if (!input.turns.length) {
      throw new MemAuraValidationError('turns must contain at least one message');
    }
    for (const turn of input.turns) {
      validateNonEmpty(turn.content, 'turn content');
    }

    const data = await this.request<IngestJobAck>((signal) =>
      memoryIngestMemoryIngestPost({
        client: this.client,
        headers: this.deviceHeaders(input.deviceNo),
        signal,
        body: {
          turns: input.turns.map((turn) => ({
            content: turn.content,
            role: turn.role,
            turn_id: turn.turnId,
            timestamp: turn.timestamp,
            sender_name: turn.senderName,
            refer_list: turn.referList,
          })),
          session_id: input.sessionId,
          group_id: input.groupId,
          group_name: input.groupName,
          commit_id: input.commitId,
        },
      }),
    );

    return {
      jobId: data.job_id,
      sessionId: data.session_id ?? undefined,
      status: data.status ?? 'queued',
      statusUrl: data.status_url,
    };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    return this.searchWith(input, memoryRetrievalMemoryRetrievalPost);
  }

  async searchHybrid(input: SearchInput): Promise<SearchResult> {
    return this.searchWith(input, memoryHybridRetrievalMemoryRetrievalHybridPost);
  }

  private readonly getJob = async (
    jobId: string,
    options?: JobLookupOptions,
    requestTimeoutMs?: number,
  ): Promise<JobStatus> => {
    const data = await this.request<IngestJobStatus>((signal) =>
      ingestJobStatusMemoryIngestJobsJobIdGet({
        client: this.client,
        headers: this.deviceHeaders(options?.deviceNo),
        path: { job_id: jobId },
        signal,
      }),
    requestTimeoutMs);

    return {
      jobId: data.job_id,
      sessionId: data.session_id,
      status: data.status,
    };
  };

  private async searchWith(
    input: SearchInput,
    operation: typeof memoryRetrievalMemoryRetrievalPost,
  ): Promise<SearchResult> {
    validateNonEmpty(input.query, 'query');
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit <= 0)) {
      throw new MemAuraValidationError('limit must be a positive integer');
    }

    const data = await this.request<MemoryRetrievalOut>((signal) =>
      operation({
        client: this.client,
        headers: this.deviceHeaders(input.deviceNo),
        signal,
        body: {
          query: input.query,
          top_k: input.limit,
          group_id: input.groupId,
        },
      }),
    );

    return {
      strategy: data.strategy ?? '',
      query: data.query ?? input.query,
      evidence: data.evidence ?? [],
      evidenceDetails: (data.evidence_details ?? []).map(mapEvidenceDetail),
      requestedGroupId: data.requested_group_id,
    };
  }

  private deviceHeaders(deviceNo?: string): HeadersInit | undefined {
    const resolvedDeviceNo = deviceNo ?? this.deviceNo;
    return resolvedDeviceNo ? { 'X-Device-No': resolvedDeviceNo } : undefined;
  }

  private async request<T>(
    operation: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = (await operation(controller.signal)) as GeneratedResult<T>;
      if (result.error !== undefined) {
        if (controller.signal.aborted) {
          throw new MemAuraTimeoutError(`Request timed out after ${timeoutMs}ms`);
        }
        throw this.toApiError(result.error, result.response);
      }

      const envelope = result.data;
      if (!envelope) {
        throw new MemAuraNetworkError('Router returned an empty response');
      }
      if (envelope.success === false || envelope.data === null || envelope.data === undefined) {
        throw this.toApiError(envelope, result.response);
      }
      return envelope.data;
    } catch (error) {
      if (error instanceof MemAuraApiError || error instanceof MemAuraNetworkError || error instanceof MemAuraTimeoutError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new MemAuraTimeoutError(`Request timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw new MemAuraNetworkError('Unable to reach MemAura Router', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private toApiError(value: unknown, response?: Response): MemAuraApiError {
    const envelope = asRecord(value);
    const data = asRecord(envelope?.data);
    const message = typeof envelope?.message === 'string' ? envelope.message : `Router request failed with status ${response?.status ?? 'unknown'}`;
    return new MemAuraApiError(message, {
      status: response?.status,
      code: typeof envelope?.code === 'number' ? envelope.code : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
      details: data?.detail,
    });
  }
}
