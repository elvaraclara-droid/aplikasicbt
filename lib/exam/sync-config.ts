export type ExamSyncMode = "hybrid_batch" | "per_click";

export interface ExamSyncProfile {
  mode: ExamSyncMode;
  /** Debounce delay before staging text/option changes into IndexedDB (and server in per_click mode). */
  answerWriteDebounceMs: number;
  essayWriteDebounceMs: number;
  /** Interval for periodic batch flush in milliseconds (0 = immediate per click). */
  batchFlushIntervalMs: number;
  /** Maximum random jitter added to flush interval so concurrent students spread traffic. */
  batchJitterMaxMs: number;
  /** Flush immediately once this many distinct questions are queued locally. */
  batchMaxDirtyCount: number;
  /** Proactively flush local queue once countdown enters final N seconds (0 = disabled). */
  preDeadlineFlushSeconds: number;
  /** Interval for server heartbeat & deadline sync in milliseconds. */
  heartbeatIntervalMs: number;
  /** Maximum random initial offset before heartbeat timer starts. */
  heartbeatJitterMaxMs: number;
}

export const EXAM_SYNC_PROFILES: Record<ExamSyncMode, ExamSyncProfile> = {
  hybrid_batch: {
    mode: "hybrid_batch",
    answerWriteDebounceMs: 180,
    essayWriteDebounceMs: 500,
    batchFlushIntervalMs: 30_000,
    batchJitterMaxMs: 5_000,
    batchMaxDirtyCount: 5,
    preDeadlineFlushSeconds: 20,
    heartbeatIntervalMs: 45_000,
    heartbeatJitterMaxMs: 5_000,
  },
  per_click: {
    mode: "per_click",
    answerWriteDebounceMs: 250,
    essayWriteDebounceMs: 900,
    batchFlushIntervalMs: 0,
    batchJitterMaxMs: 0,
    batchMaxDirtyCount: 1,
    preDeadlineFlushSeconds: 0,
    heartbeatIntervalMs: 15_000,
    heartbeatJitterMaxMs: 0,
  },
};

/**
 * Resolves the active exam sync mode from env (`NEXT_PUBLIC_EXAM_SYNC_MODE`), defaulting to `hybrid_batch`.
 */
export function resolveExamSyncMode(
  rawMode = process.env.NEXT_PUBLIC_EXAM_SYNC_MODE
): ExamSyncMode {
  return rawMode === "per_click" ? "per_click" : "hybrid_batch";
}

export function getExamSyncProfile(mode?: ExamSyncMode): ExamSyncProfile {
  return EXAM_SYNC_PROFILES[mode ?? resolveExamSyncMode()];
}

export function computeJitteredDelayMs(
  baseMs: number,
  maxJitterMs: number,
  randomValue = Math.random()
): number {
  if (baseMs <= 0) return 0;
  if (maxJitterMs <= 0) return baseMs;
  const clamped = Math.min(1, Math.max(0, randomValue));
  return baseMs + Math.round(clamped * maxJitterMs);
}
