export type MemoryRole = 'assistant' | 'system' | 'user';

export interface MemoryOptions {
  apiKey: string;
  endpoint?: string;
  deviceNo?: string;
  timeoutMs?: number;
}

export interface MemoryTurn {
  content: string;
  role?: MemoryRole;
  turnId?: string;
  timestamp?: string;
  senderName?: string;
  referList?: string[];
}

export interface AddInput {
  turns: MemoryTurn[];
  sessionId?: string;
  groupId?: string;
  groupName?: string;
  commitId?: string;
  deviceNo?: string;
}

export interface AddResult {
  jobId: string;
  sessionId?: string;
  status: string;
  statusUrl: string;
}

export interface SearchInput {
  query: string;
  limit?: number;
  groupId?: string;
  deviceNo?: string;
}

export interface EvidenceDetail {
  eventId: string;
  text: string;
  source?: string;
  role?: string | null;
  senderName?: string | null;
  atomicFacts?: string[];
  groupId?: string | null;
  timestamp?: string | null;
}

export interface SearchResult {
  strategy: string;
  query: string;
  evidence: string[];
  evidenceDetails: EvidenceDetail[];
  requestedGroupId?: string | null;
}

export interface JobStatus {
  jobId?: string | null;
  sessionId?: string | null;
  status?: string | null;
}

export interface JobLookupOptions {
  deviceNo?: string;
}

export interface WaitForJobOptions extends JobLookupOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}
