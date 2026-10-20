import {
  MemAuraApiError,
  MemAuraNetworkError,
  MemAuraTimeoutError,
  MemAuraValidationError,
} from './errors';
import type { MemoryRole } from './types';

const defaultV4Endpoint = 'https://api.omnimemory.cn/api/v3';
const pendingStatuses = new Set(['queued', 'staged', 'processing', 'buffered', 'indexing']);
const terminalStatuses = new Set(['succeeded', 'failed']);

export interface MemoryV4Options {
  apiKey: string;
  endpoint?: string;
  deviceNo?: string;
  timeoutMs?: number;
}

export interface V4Turn {
  content: string;
  role?: MemoryRole;
  turnId?: string;
  timestamp?: string;
  senderName?: string;
  referList?: string[];
}

export interface V4IngestInput {
  turns: V4Turn[];
  language?: 'auto' | 'zh' | 'en';
  timezone?: string;
  deviceNo?: string;
  waitFor?: 'staged' | 'searchable';
  waitTimeoutSeconds?: number;
}

export interface V4Job {
  jobId: string;
  status?: string;
  waitTimedOut?: boolean;
  error?: { code?: string; message?: string };
}

export interface V4Episode {
  episodeId: string;
  summary: string;
}

export interface V4Card {
  cardId: string;
  role: string;
  content: string;
  episodes: V4Episode[];
}

export interface V4RetrievalInput {
  query: string;
  topK?: number;
  vectorWeight?: number;
  tagKeys?: string[];
  role?: string;
  scopeType?: 'account' | 'api_key' | 'device';
  startTime?: string;
  endTime?: string;
  entityId?: string;
  entityMatchMode?: 'primary' | 'involved' | 'source';
  participantRoles?: string[];
  deviceNo?: string;
  includeQueryAnalysis?: boolean;
  includeDetails?: boolean;
}

export interface V4RetrievalResult {
  cards: V4Card[];
  queryAnalysis?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface V4WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new MemAuraValidationError(`${name} must not be empty`);
  return normalized;
};

const normalizeEndpoint = (value: string): string => {
  try {
    return new URL(value).toString().replace(/\/+$/, '');
  } catch {
    throw new MemAuraValidationError('endpoint must be an absolute URL');
  }
};

export class V4JobOperations {
  constructor(private readonly memory: MemoryV4) {}

  get(jobId: string): Promise<V4Job> {
    return this.memory.getJob(requireText(jobId, 'jobId'));
  }

  async wait(jobId: string, options: V4WaitOptions = {}): Promise<V4Job> {
    const normalizedJobId = requireText(jobId, 'jobId');
    const timeoutMs = options.timeoutMs ?? 300_000;
    const intervalMs = options.intervalMs ?? 1_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new MemAuraValidationError('timeoutMs must be greater than zero');
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new MemAuraValidationError('intervalMs must be greater than zero');
    }

    const deadline = Date.now() + timeoutMs;
    let lastJob: V4Job | undefined;
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw new MemAuraNetworkError('Job wait was aborted');
      lastJob = await this.memory.getJob(normalizedJobId, Math.max(1, deadline - Date.now()));
      const status = (lastJob.status ?? '').toLowerCase();
      if (terminalStatuses.has(status)) return lastJob;
      if (!pendingStatuses.has(status)) {
        throw new MemAuraNetworkError(`Unexpected V4 job status: ${lastJob.status ?? '<missing>'}`);
      }
      const delay = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new MemAuraNetworkError('Job wait was aborted'));
          };
          const timer = setTimeout(() => {
            options.signal?.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          options.signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
    }
    throw new MemAuraTimeoutError(`Timed out waiting for V4 ingest job ${normalizedJobId}; continue polling the same job`, {
      lastJob,
    });
  }
}

export class MemoryV4 {
  readonly jobs: V4JobOperations;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly deviceNo?: string;

  constructor(private readonly options: MemoryV4Options) {
    requireText(options.apiKey, 'apiKey');
    this.endpoint = normalizeEndpoint(options.endpoint ?? defaultV4Endpoint);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new MemAuraValidationError('timeoutMs must be greater than zero');
    }
    this.deviceNo = options.deviceNo;
    this.jobs = new V4JobOperations(this);
  }

  async ingest(input: V4IngestInput): Promise<V4Job> {
    if (!input.turns.length) {
      throw new MemAuraValidationError('turns must contain at least one message');
    }
    const waitTimeoutSeconds = input.waitTimeoutSeconds ?? 120;
    if (!Number.isFinite(waitTimeoutSeconds) || waitTimeoutSeconds <= 0 || waitTimeoutSeconds > 300) {
      throw new MemAuraValidationError('waitTimeoutSeconds must be between 0 and 300');
    }
    const turns = input.turns.map((turn, index) => ({
      content: requireText(turn.content, `turns[${index}].content`),
      role: turn.role,
      turn_id: turn.turnId,
      timestamp: turn.timestamp,
      sender_name: turn.senderName,
      refer_list: turn.referList,
    }));
    const data = await this.request('/memory/ingest_4', {
      method: 'POST',
      deviceNo: input.deviceNo,
      body: {
        turns,
        language: input.language ?? 'auto',
        timezone: input.timezone,
        wait_for: input.waitFor ?? 'staged',
        wait_timeout_seconds: waitTimeoutSeconds,
      },
    });
    return this.toJob(data);
  }

  async retrieve(input: V4RetrievalInput): Promise<V4RetrievalResult> {
    const topK = input.topK;
    if (topK !== undefined && (!Number.isInteger(topK) || topK < 1 || topK > 100)) {
      throw new MemAuraValidationError('topK must be an integer between 1 and 100');
    }
    const vectorWeight = input.vectorWeight ?? 0.8;
    if (!Number.isFinite(vectorWeight) || vectorWeight < 0 || vectorWeight > 1) {
      throw new MemAuraValidationError('vectorWeight must be between 0 and 1');
    }
    const includeDetails = input.includeDetails ?? false;
    const data = await this.request('/memory/retrieval_4', {
      method: 'POST',
      deviceNo: input.deviceNo,
      body: {
        query: requireText(input.query, 'query'),
        top_k: topK,
        vector_weight: vectorWeight,
        tag_keys: input.tagKeys ?? [],
        role: input.role,
        scope_type: input.scopeType,
        start_time: input.startTime,
        end_time: input.endTime,
        entity_id: input.entityId,
        entity_match_mode: input.entityMatchMode,
        participant_roles: input.participantRoles,
        include_query_analysis: input.includeQueryAnalysis ?? false,
        include_details: includeDetails,
      },
    });
    if (!Array.isArray(data.results)) {
      throw new MemAuraNetworkError('Invalid V4 retrieval response: missing results');
    }
    const cards = data.results.map((value): V4Card => {
      const card = asRecord(value);
      if (!card) throw new MemAuraNetworkError('Invalid V4 retrieval response: Card must be an object');
      const episodes = Array.isArray(card.episodes) ? card.episodes : [];
      return {
        cardId: String(card.card_id ?? ''),
        role: String(card.role ?? ''),
        content: String(card.content ?? ''),
        episodes: episodes.map((episode) => {
          const item = asRecord(episode) ?? {};
          return { episodeId: String(item.episode_id ?? ''), summary: String(item.summary ?? '') };
        }),
      };
    });
    return {
      cards,
      queryAnalysis: asRecord(data.query_analysis),
      details: includeDetails ? data : undefined,
    };
  }

  async getJob(jobId: string, timeoutMs?: number): Promise<V4Job> {
    const data = await this.request(`/memory/ingest_4/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, timeoutMs);
    return this.toJob(data, jobId);
  }

  private toJob(data: JsonRecord, fallbackJobId = ''): V4Job {
    const jobId = String(data.job_id ?? fallbackJobId);
    if (!jobId) throw new MemAuraNetworkError('Invalid V4 job response: missing job_id');
    const error = asRecord(data.error);
    return {
      jobId,
      status: typeof data.status === 'string' ? data.status : undefined,
      waitTimedOut: data.wait_timed_out === true,
      error: error ? {
        code: typeof error.code === 'string' ? error.code : undefined,
        message: typeof error.message === 'string' ? error.message : undefined,
      } : undefined,
    };
  }

  private async request(
    path: string,
    request: { method: 'GET' | 'POST'; body?: JsonRecord; deviceNo?: string },
    timeoutMs = this.timeoutMs,
  ): Promise<JsonRecord> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
      'X-API-Key': this.options.apiKey,
      'Content-Type': 'application/json',
    };
    const deviceNo = request.deviceNo ?? this.deviceNo;
    if (deviceNo) headers['X-Device-No'] = deviceNo;
    try {
      const response = await fetch(this.endpoint + path, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch (error) {
        throw new MemAuraNetworkError('Router returned invalid JSON', { cause: error });
      }
      const payload = asRecord(decoded);
      if (!payload) throw new MemAuraNetworkError('Router returned an invalid response');
      const compactError = asRecord(payload.error);
      if (!response.ok || payload.success === false || compactError) {
        const envelopeData = asRecord(payload.data);
        throw new MemAuraApiError(
          String(compactError?.message ?? payload.message ?? `Router request failed with status ${response.status}`),
          {
            status: response.status,
            code: typeof payload.code === 'number' ? payload.code : undefined,
            error: String(compactError?.code ?? envelopeData?.error ?? 'request_failed'),
            details: envelopeData?.detail,
          },
        );
      }
      if (payload.success === true) {
        const data = asRecord(payload.data);
        if (!data) throw new MemAuraNetworkError('Router returned an empty response envelope');
        clearTimeout(timer);
        return data;
      }
      clearTimeout(timer);
      return payload;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof MemAuraApiError || error instanceof MemAuraNetworkError) throw error;
      if (controller.signal.aborted) {
        throw new MemAuraTimeoutError(`Request timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw new MemAuraNetworkError('Unable to reach MemAura Router', { cause: error });
    }
  }
}
