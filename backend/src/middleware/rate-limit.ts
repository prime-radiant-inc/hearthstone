// In-memory, single-process token-bucket rate limiter.
// Spec: docs/superpowers/specs/2026-04-16-rate-limiting-design.md

export type Tier = "1" | "2" | "3";

export interface BucketConfig {
  capacity: number;
  refillPerSec: number;
}

export const LIMITS: Record<Tier, BucketConfig[]> = {
  "1": [
    { capacity: 10, refillPerSec: 10 / 60 },
    { capacity: 60, refillPerSec: 60 / 3600 },
  ],
  "2": [
    { capacity: 30, refillPerSec: 30 / 60 },
    { capacity: 300, refillPerSec: 300 / 3600 },
  ],
  "3": [
    { capacity: 300, refillPerSec: 300 / 60 },
  ],
};

export interface Decision {
  allowed: boolean;
  retryAfterSec: number; // 0 when allowed
  tier: Tier;
  tokens: number;        // lowest bucket's tokens after the hit (for admin view)
  capacity: number;      // matching bucket's capacity
}

export interface RejectionEvent {
  ts: string;
  route: string;
  tier: Tier;
  key: string;
  retry_after_seconds: number;
}

export interface ThrottledEntry {
  tier: Tier;
  key: string;
  tokens: number;
  capacity: number;
  retry_after_seconds: number;
}

interface Bucket { tokens: number; lastRefill: number }
interface Entry { buckets: Bucket[]; tier: Tier; key: string; lastAccess: number }

export interface RateLimiter {
  check: (key: string, tier: Tier) => Decision;
  recordRejection: (event: RejectionEvent) => void;
  clear: (key: string) => void;
  sweep: () => void;
  admin: () => { throttled: ThrottledEntry[]; rejections: RejectionEvent[] };
}

const REJECTION_BUFFER_SIZE = 200;

export function createRateLimiter(opts: { now?: () => number } = {}): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const rejections: RejectionEvent[] = []; // ring buffer

  function entryKey(tier: Tier, key: string): string {
    return `${tier}:${key}`;
  }

  function maxWindowSec(tier: Tier): number {
    // Longest refill window across this tier's buckets, for GC decisions.
    return Math.max(...LIMITS[tier].map(b => b.capacity / b.refillPerSec));
  }

  function refill(bucket: Bucket, cfg: BucketConfig, t: number): void {
    const elapsed = (t - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsed * cfg.refillPerSec);
    bucket.lastRefill = t;
  }

  function check(key: string, tier: Tier): Decision {
    const t = now();
    const ek = entryKey(tier, key);
    const cfgs = LIMITS[tier];

    let entry = entries.get(ek);
    if (!entry) {
      entry = {
        buckets: cfgs.map(c => ({ tokens: c.capacity, lastRefill: t })),
        tier, key, lastAccess: t,
      };
      entries.set(ek, entry);
    }

    // Refill all buckets first.
    for (let i = 0; i < cfgs.length; i++) refill(entry.buckets[i], cfgs[i], t);
    entry.lastAccess = t;

    // If all buckets have >= 1 token, consume one from each.
    const allHave = entry.buckets.every(b => b.tokens >= 1);
    if (allHave) {
      for (const b of entry.buckets) b.tokens -= 1;
      // Report the tightest bucket's state for admin visibility.
      let minIdx = 0;
      for (let i = 1; i < entry.buckets.length; i++) {
        const ratioI = entry.buckets[i].tokens / cfgs[i].capacity;
        const ratioMin = entry.buckets[minIdx].tokens / cfgs[minIdx].capacity;
        if (ratioI < ratioMin) minIdx = i;
      }
      maybePrune(ek, entry);
      return {
        allowed: true, retryAfterSec: 0, tier,
        tokens: entry.buckets[minIdx].tokens,
        capacity: cfgs[minIdx].capacity,
      };
    }

    // Reject using the first denying bucket.
    const denyIdx = entry.buckets.findIndex(b => b.tokens < 1);
    const b = entry.buckets[denyIdx];
    const cfg = cfgs[denyIdx];
    const retryAfterSec = Math.max(1, Math.ceil((1 - b.tokens) / cfg.refillPerSec));
    return {
      allowed: false, retryAfterSec, tier,
      tokens: b.tokens, capacity: cfg.capacity,
    };
  }

  function maybePrune(ek: string, entry: Entry): void {
    const cfgs = LIMITS[entry.tier];
    const allFull = entry.buckets.every((b, i) => b.tokens >= cfgs[i].capacity);
    if (!allFull) return;
    const t = now();
    if (t - entry.lastAccess > maxWindowSec(entry.tier) * 2 * 1000) {
      entries.delete(ek);
    }
  }

  function clear(key: string): void {
    for (const tier of ["1", "2", "3"] as Tier[]) {
      entries.delete(entryKey(tier, key));
    }
  }

  function sweep(): void {
    const t = now();
    for (const [ek, entry] of entries) {
      const cfgs = LIMITS[entry.tier];
      for (let i = 0; i < cfgs.length; i++) refill(entry.buckets[i], cfgs[i], t);
      const allFull = entry.buckets.every((b, i) => b.tokens >= cfgs[i].capacity);
      if (allFull && t - entry.lastAccess > maxWindowSec(entry.tier) * 2 * 1000) {
        entries.delete(ek);
      }
    }
  }

  function recordRejection(event: RejectionEvent): void {
    rejections.push(event);
    if (rejections.length > REJECTION_BUFFER_SIZE) rejections.shift();
  }

  function admin(): { throttled: ThrottledEntry[]; rejections: RejectionEvent[] } {
    const t = now();
    const throttled: ThrottledEntry[] = [];
    for (const entry of entries.values()) {
      const cfgs = LIMITS[entry.tier];
      // Compute current token counts without mutating state.
      const currentTokens = entry.buckets.map((b, i) => {
        const elapsed = (t - b.lastRefill) / 1000;
        return Math.min(cfgs[i].capacity, b.tokens + elapsed * cfgs[i].refillPerSec);
      });
      for (let i = 0; i < cfgs.length; i++) {
        if (currentTokens[i] < 1) {
          throttled.push({
            tier: entry.tier,
            key: entry.key,
            tokens: Math.round(currentTokens[i] * 100) / 100,
            capacity: cfgs[i].capacity,
            retry_after_seconds: Math.max(1, Math.ceil((1 - currentTokens[i]) / cfgs[i].refillPerSec)),
          });
          break; // one row per entry
        }
      }
    }
    return { throttled, rejections: [...rejections].reverse() };
  }

  return { check, recordRejection, clear, sweep, admin };
}
