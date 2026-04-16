# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tiered rate limiting across the Hearthstone backend: per-IP tight on `/auth/pin/redeem`, per-household on expensive endpoints, per-IP loose catch-all on everything else, with an admin panel showing live throttles and recent rejections.

**Architecture:** One in-memory token-bucket limiter module (`backend/src/middleware/rate-limit.ts`). Route handlers call a thin `rateLimited(req, tier, key)` helper at the top of each guarded route in `backend/src/index.ts`. Admin routes expose the limiter's state; the admin HTML page polls and renders it. Injectable clock for tests. Fail-open on limiter errors.

**Tech Stack:** TypeScript on Bun, `bun:test`, existing OTel tracing (`src/tracing.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-16-rate-limiting-design.md`

**Conventions to respect:**
- Tests use `createTestDb()` from `backend/tests/helpers.ts`. Never hit the real DB.
- API speaks snake_case in JSON bodies.
- No catchall middleware — the route table in `index.ts` is the hub; each guarded route gets an explicit `rateLimited()` call.
- Honeycomb tracing is optional — structured stderr log is the fallback, not the other way around.
- Existing admin CSS classes live in `backend/src/html/admin-page.ts`. Reuse `.card`, `table`, `button.row-action`, `.toolbar`.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/middleware/rate-limit.ts` | **Create** | Token-bucket limiter factory, `LIMITS`, `Tier` type, `rateLimited()` HTTP helper, `resolveClientIp()`. |
| `backend/src/routes/admin.ts` | **Modify** | Add `handleAdminRateLimits`, `handleAdminClearRateLimit`. |
| `backend/src/html/admin-page.ts` | **Modify** | Render Rate Limits section; poll every 5s; wire Clear button. |
| `backend/src/index.ts` | **Modify** | Instantiate limiter singleton, start sweep, register admin routes, add `rateLimited()` call at top of each guarded route. |
| `backend/tests/rate-limit.test.ts` | **Create** | Unit tests for bucket math, GC, key isolation, clear, IP resolution, 429 shape. |
| `backend/tests/rate-limit-integration.test.ts` | **Create** | Integration test: hammer `POST /auth/pin/redeem` through the full request path. |
| `BACKLOG.md` | **Modify** | Remove the rate-limiting entry. |
| `docs/decisions/decisions-security.md` | **Modify** | Update §PIN redemption to reflect that rate limiting landed. |

---

## Task 1: Core limiter — types, LIMITS, token-bucket math

**Files:**
- Create: `backend/src/middleware/rate-limit.ts`
- Create: `backend/tests/rate-limit.test.ts`

- [ ] **Step 1.1: Write failing test for token-bucket refill**

Create `backend/tests/rate-limit.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { createRateLimiter, LIMITS } from "../src/middleware/rate-limit";

describe("rate limiter — token bucket", () => {
  it("allows up to capacity then rejects", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });

    // Tier 1 capacity = 10
    for (let i = 0; i < 10; i++) {
      expect(rl.check("1.2.3.4", "1").allowed).toBe(true);
    }
    const denied = rl.check("1.2.3.4", "1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it("refills over time", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });

    for (let i = 0; i < 10; i++) rl.check("k", "1");
    expect(rl.check("k", "1").allowed).toBe(false);

    // Tier 1 refill is 10/60 per second; 6s → 1 token
    now += 6000;
    expect(rl.check("k", "1").allowed).toBe(true);
    expect(rl.check("k", "1").allowed).toBe(false);
  });

  it("capacity clamps — long idle does not overflow", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });

    rl.check("k", "1"); // initialize
    now += 3_600_000; // 1h later
    for (let i = 0; i < 10; i++) {
      expect(rl.check("k", "1").allowed).toBe(true);
    }
    expect(rl.check("k", "1").allowed).toBe(false); // clamped at 10
  });

  it("retry_after_seconds is ceil((1 - tokens) / refill)", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 10; i++) rl.check("k", "1");
    const denied = rl.check("k", "1");
    // tokens ≈ 0, refill = 10/60, so retry ≈ ceil(6) = 6
    expect(denied.retryAfterSec).toBe(6);
  });

  it("multi-bucket composition — hour budget blocks even when minute has room", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });

    // Tier 1: 10/min + 60/hr. To exhaust the hour bucket while keeping
    // the minute bucket non-binding, do 6 batches of 10 separated by 60s
    // (refills minute fully; hour accrues +1 per gap), then start a 7th
    // batch. After 6 batches, hour bucket is at 5; the 60s refill before
    // batch 7 brings it to 6. 6 successful calls into batch 7 exhaust
    // hour. Minute bucket has 4 tokens left — still non-binding.
    for (let batch = 0; batch < 6; batch++) {
      for (let i = 0; i < 10; i++) {
        expect(rl.check("k", "1").allowed).toBe(true);
      }
      now += 60_000;
    }
    // Batch 7: 6 allowed, then denied while minute still has room.
    for (let i = 0; i < 6; i++) {
      expect(rl.check("k", "1").allowed).toBe(true);
    }
    const denied = rl.check("k", "1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates keys", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 10; i++) rl.check("a", "1");
    expect(rl.check("a", "1").allowed).toBe(false);
    expect(rl.check("b", "1").allowed).toBe(true);
  });

  it("clear(key) resets all tiers for that key", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 10; i++) rl.check("k", "1");
    expect(rl.check("k", "1").allowed).toBe(false);
    rl.clear("k");
    expect(rl.check("k", "1").allowed).toBe(true);
  });

  it("sweep removes idle entries whose buckets are full", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    rl.check("k", "1");
    // Long idle — beyond maxWindow * 2 = 7200s
    now += 8000 * 1000;
    rl.sweep();
    // Evidence: a new key still works, but we can only assert the key is
    // GC'd by peeking at admin() — which should show no throttled entries.
    expect(rl.admin().throttled.length).toBe(0);
  });

  it("LIMITS is the expected shape", () => {
    expect(LIMITS["1"]).toEqual([
      { capacity: 10, refillPerSec: 10 / 60 },
      { capacity: 60, refillPerSec: 60 / 3600 },
    ]);
    expect(LIMITS["2"]).toEqual([
      { capacity: 30, refillPerSec: 30 / 60 },
      { capacity: 300, refillPerSec: 300 / 3600 },
    ]);
    expect(LIMITS["3"]).toEqual([
      { capacity: 300, refillPerSec: 300 / 60 },
    ]);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: FAIL — "Cannot find module '../src/middleware/rate-limit'"

- [ ] **Step 1.3: Create `backend/src/middleware/rate-limit.ts` with the core limiter**

```ts
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
      // Refill a copy for a read-only snapshot.
      for (let i = 0; i < cfgs.length; i++) {
        const b = entry.buckets[i];
        const elapsed = (t - b.lastRefill) / 1000;
        const tokens = Math.min(cfgs[i].capacity, b.tokens + elapsed * cfgs[i].refillPerSec);
        if (tokens < 1) {
          throttled.push({
            tier: entry.tier,
            key: entry.key,
            tokens: Math.round(tokens * 100) / 100,
            capacity: cfgs[i].capacity,
            retry_after_seconds: Math.max(1, Math.ceil((1 - tokens) / cfgs[i].refillPerSec)),
          });
          break; // one row per entry
        }
      }
    }
    return { throttled, rejections: [...rejections].reverse() };
  }

  return { check, recordRejection, clear, sweep, admin };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 1.5: Commit**

```bash
git add backend/src/middleware/rate-limit.ts backend/tests/rate-limit.test.ts
git commit -m "feat(rate-limit): token-bucket core with LIMITS and unit tests"
```

---

## Task 2: Client IP resolution

**Files:**
- Modify: `backend/src/middleware/rate-limit.ts`
- Modify: `backend/tests/rate-limit.test.ts`

- [ ] **Step 2.1: Write failing tests for `resolveClientIp`**

Append to `backend/tests/rate-limit.test.ts`:

```ts
import { resolveClientIp } from "../src/middleware/rate-limit";

describe("resolveClientIp", () => {
  function mkReq(headers: Record<string, string>): Request {
    return new Request("http://test/x", { headers });
  }

  it("prefers Fly-Client-IP", () => {
    expect(resolveClientIp(mkReq({
      "fly-client-ip": "9.9.9.9",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      "x-real-ip": "3.3.3.3",
    }))).toBe("9.9.9.9");
  });

  it("falls back to rightmost X-Forwarded-For", () => {
    expect(resolveClientIp(mkReq({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3",
    }))).toBe("3.3.3.3");
  });

  it("trims X-Forwarded-For whitespace", () => {
    expect(resolveClientIp(mkReq({
      "x-forwarded-for": "1.1.1.1,   2.2.2.2  ",
    }))).toBe("2.2.2.2");
  });

  it("falls back to X-Real-IP", () => {
    expect(resolveClientIp(mkReq({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("falls back to 'unknown' when no header is present", () => {
    expect(resolveClientIp(mkReq({}))).toBe("unknown");
  });
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: FAIL — "Export named 'resolveClientIp' not found".

- [ ] **Step 2.3: Add `resolveClientIp` to `backend/src/middleware/rate-limit.ts`**

Append:

```ts
export function resolveClientIp(req: Request): string {
  const fly = req.headers.get("fly-client-ip");
  if (fly) return fly.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();

  return "unknown";
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 2.5: Commit**

```bash
git add backend/src/middleware/rate-limit.ts backend/tests/rate-limit.test.ts
git commit -m "feat(rate-limit): client IP resolution with Fly/XFF/XRI fallbacks"
```

---

## Task 3: HTTP helper `rateLimited()` + admin route handlers

**Files:**
- Modify: `backend/src/middleware/rate-limit.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `backend/tests/rate-limit.test.ts`

- [ ] **Step 3.1: Write failing tests for `rateLimited` and admin handlers**

Append to `backend/tests/rate-limit.test.ts`:

```ts
import { rateLimited } from "../src/middleware/rate-limit";
import { handleAdminRateLimits, handleAdminClearRateLimit } from "../src/routes/admin";

describe("rateLimited helper", () => {
  function mkReq(ip = "1.2.3.4"): Request {
    return new Request("http://test/x", { headers: { "fly-client-ip": ip } });
  }

  it("returns null when allowed", async () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    const res = rateLimited(rl, mkReq(), "1", "1.2.3.4", "POST /auth/pin/redeem");
    expect(res).toBeNull();
  });

  it("returns a 429 Response with Retry-After + retry_after_seconds", async () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 10; i++) rateLimited(rl, mkReq(), "1", "1.2.3.4", "POST /auth/pin/redeem");
    const res = rateLimited(rl, mkReq(), "1", "1.2.3.4", "POST /auth/pin/redeem")!;
    expect(res).not.toBeNull();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/\d+ second/);
    expect(typeof body.retry_after_seconds).toBe("number");
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(Object.keys(body).sort()).toEqual(["message", "retry_after_seconds"]);
  });

  it("records rejections into admin().rejections", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 11; i++) rateLimited(rl, mkReq(), "1", "1.2.3.4", "POST /auth/pin/redeem");
    const r = rl.admin().rejections;
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({
      route: "POST /auth/pin/redeem",
      tier: "1",
      key: "1.2.3.4",
    });
    expect(typeof r[0].ts).toBe("string");
    expect(r[0].retry_after_seconds).toBeGreaterThan(0);
  });

  it("fails open if limiter throws", () => {
    const broken = {
      check() { throw new Error("boom"); },
      recordRejection() {},
      clear() {},
      sweep() {},
      admin() { return { throttled: [], rejections: [] }; },
    };
    const res = rateLimited(broken as any, mkReq(), "1", "1.2.3.4", "POST /x");
    expect(res).toBeNull();
  });
});

describe("admin rate-limit handlers", () => {
  it("GET /admin/rate-limits returns throttled + rejections arrays", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 11; i++) rl.check("1.2.3.4", "1");
    rl.recordRejection({
      ts: new Date(now).toISOString(),
      route: "POST /auth/pin/redeem",
      tier: "1",
      key: "1.2.3.4",
      retry_after_seconds: 6,
    });

    const res = handleAdminRateLimits(rl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.throttled)).toBe(true);
    expect(Array.isArray(res.body.rejections)).toBe(true);
    expect(res.body.throttled.length).toBe(1);
    expect(res.body.throttled[0]).toMatchObject({
      tier: "1", key: "1.2.3.4",
    });
    expect(res.body.throttled[0].retry_after_seconds).toBeGreaterThan(0);
  });

  it("POST /admin/rate-limits/clear nukes the key and returns 204", () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    for (let i = 0; i < 11; i++) rl.check("1.2.3.4", "1");
    const res = handleAdminClearRateLimit(rl, { key: "1.2.3.4" });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(rl.check("1.2.3.4", "1").allowed).toBe(true);
  });

  it("POST /admin/rate-limits/clear returns 422 if key missing", () => {
    const rl = createRateLimiter();
    const res = handleAdminClearRateLimit(rl, {} as any);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ message: "key is required" });
  });
});
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: FAIL — `rateLimited` / `handleAdminRateLimits` / `handleAdminClearRateLimit` not exported.

- [ ] **Step 3.3: Add `rateLimited` to `backend/src/middleware/rate-limit.ts`**

Append:

```ts
import { trace, type Context } from "@opentelemetry/api";

export function rateLimited(
  rl: RateLimiter,
  _req: Request,
  tier: Tier,
  key: string,
  route: string,
  ctx?: Context,
): Response | null {
  let decision: Decision;
  try {
    decision = rl.check(key, tier);
  } catch (err) {
    console.error(JSON.stringify({
      event: "rate_limit_check_failed",
      ts: new Date().toISOString(),
      route, tier, key,
      error: (err as Error).message,
    }));
    return null; // fail open
  }

  // OTel span attributes — no-op if tracing isn't configured.
  const span = ctx ? trace.getSpan(ctx) : undefined;
  if (span) {
    span.setAttribute("ratelimit.tier", tier);
    span.setAttribute("ratelimit.key", key);
    span.setAttribute("ratelimit.allowed", decision.allowed);
    if (!decision.allowed) {
      span.setAttribute("ratelimit.retry_after_seconds", decision.retryAfterSec);
    }
  }

  if (decision.allowed) return null;

  const retry = decision.retryAfterSec;
  const body = {
    message: `Too many requests. Try again in ${retry} seconds.`,
    retry_after_seconds: retry,
  };
  const event = {
    ts: new Date().toISOString(),
    route, tier, key, retry_after_seconds: retry,
  };

  try { rl.recordRejection(event); } catch {/* ignore */}

  console.warn(JSON.stringify({ event: "rate_limit_rejected", ...event }));

  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retry),
    },
  });
}
```

Note: `@opentelemetry/api` is already a transitive dep via `src/tracing.ts` — no new install.

- [ ] **Step 3.4: Add admin handlers to `backend/src/routes/admin.ts`**

Append to `backend/src/routes/admin.ts`:

```ts
import type { RateLimiter } from "../middleware/rate-limit";

export function handleAdminRateLimits(
  rl: RateLimiter,
): { status: number; body: any } {
  return { status: 200, body: rl.admin() };
}

export function handleAdminClearRateLimit(
  rl: RateLimiter,
  body: { key?: string } | null,
): { status: number; body: any } {
  const key = body?.key?.trim();
  if (!key) return { status: 422, body: { message: "key is required" } };
  rl.clear(key);
  return { status: 204, body: null };
}
```

- [ ] **Step 3.5: Run tests to verify they pass**

Run: `cd backend && bun test tests/rate-limit.test.ts`
Expected: PASS (all tests).

- [ ] **Step 3.6: Commit**

```bash
git add backend/src/middleware/rate-limit.ts backend/src/routes/admin.ts backend/tests/rate-limit.test.ts
git commit -m "feat(rate-limit): rateLimited helper and admin handlers"
```

---

## Task 4: Wire into `index.ts` + integration test

**Files:**
- Modify: `backend/src/index.ts`
- Create: `backend/tests/rate-limit-integration.test.ts`

- [ ] **Step 4.1: Write failing integration test**

Create `backend/tests/rate-limit-integration.test.ts`:

```ts
import "./helpers"; // sets env vars before any app import

import { describe, it, expect, beforeEach } from "bun:test";
import { createRateLimiter, rateLimited } from "../src/middleware/rate-limit";

// This test exercises the wiring pattern used in index.ts without
// booting Bun.serve: we construct a limiter and call the same helper
// sequence the handler uses.

describe("integration — pin redeem rate limit", () => {
  it("rejects 11th request from same IP with 429 + Retry-After", async () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    const req = (ip: string) =>
      new Request("http://test/auth/pin/redeem", { headers: { "fly-client-ip": ip } });

    for (let i = 0; i < 10; i++) {
      const res = rateLimited(rl, req("1.2.3.4"), "1", "1.2.3.4", "POST /auth/pin/redeem");
      expect(res).toBeNull();
    }
    const res = rateLimited(rl, req("1.2.3.4"), "1", "1.2.3.4", "POST /auth/pin/redeem")!;
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("isolates distinct IPs", async () => {
    let now = 1_000_000;
    const rl = createRateLimiter({ now: () => now });
    const req = (ip: string) =>
      new Request("http://test/auth/pin/redeem", { headers: { "fly-client-ip": ip } });

    for (let i = 0; i < 10; i++) {
      rateLimited(rl, req("1.2.3.4"), "1", "1.2.3.4", "POST /auth/pin/redeem");
    }
    // Different IP still allowed
    const res = rateLimited(rl, req("9.9.9.9"), "1", "9.9.9.9", "POST /auth/pin/redeem");
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run to verify it passes already** (the helper works; this test is an executable contract for the wiring)

Run: `cd backend && bun test tests/rate-limit-integration.test.ts`
Expected: PASS.

- [ ] **Step 4.3: Modify `backend/src/index.ts` — imports and singleton**

Near the top of `backend/src/index.ts`, alongside the other imports, add:

```ts
import { createRateLimiter, resolveClientIp, rateLimited, type Tier } from "./middleware/rate-limit";
import { handleAdminRateLimits, handleAdminClearRateLimit } from "./routes/admin";
```

After `const _adminToken = mintAdminToken();` and its log lines, before `Bun.serve(...)`, add:

```ts
const rateLimiter = createRateLimiter();

// Guard against hot-reload stacking intervals in dev.
if (!(globalThis as any).__rateLimitSweep && process.env.NODE_ENV !== "test") {
  (globalThis as any).__rateLimitSweep = setInterval(() => rateLimiter.sweep(), 5 * 60 * 1000);
}
```

- [ ] **Step 4.4: Add a local helper inside `handleRequest` to gate a route**

Immediately after `const method = req.method;` inside `handleRequest`, add:

```ts
const clientIp = resolveClientIp(req);
const guard = (tier: Tier, key: string, routeLabel: string): Response | null =>
  rateLimited(rateLimiter, req, tier, key, routeLabel, ctx);
```

`ctx` is the first parameter of `handleRequest` — the parent span's context, used so rate-limit attributes attach to the HTTP span Honeycomb already sees.

- [ ] **Step 4.5: Wire Tier 1 onto `POST /auth/pin/redeem`**

Find:

```ts
if (method === "POST" && pathname === "/auth/pin/redeem") {
  const body = await req.json();
  const result = await handlePinRedeem(getDb(), body, config.jwtSecret);
  return json(result.body, result.status);
}
```

Replace with:

```ts
if (method === "POST" && pathname === "/auth/pin/redeem") {
  const limited = guard("1", clientIp, "POST /auth/pin/redeem");
  if (limited) return limited;
  const body = await req.json();
  const result = await handlePinRedeem(getDb(), body, config.jwtSecret);
  return json(result.body, result.status);
}
```

- [ ] **Step 4.6: Wire Tier 2 onto expensive endpoints**

For **each** of these routes, insert the guard line immediately after authentication succeeds (so we key on the authenticated `householdId`):

`POST /chat`:

```ts
if (method === "POST" && pathname === "/chat") {
  const guest = authenticateGuest(getDb(), req.headers.get("authorization"));
  assertHouseholdExists(getDb(), guest.householdId);
  const limited = guard("2", guest.householdId, "POST /chat");
  if (limited) return limited;
  const body = await req.json();
  return handleChat(ctx, getDb(), guest.householdId, body);
}
```

`POST /chat/preview`:

```ts
if (method === "POST" && pathname === "/chat/preview") {
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  assertHouseholdExists(getDb(), owner.householdId);
  const limited = guard("2", owner.householdId, "POST /chat/preview");
  if (limited) return limited;
  const body = await req.json();
  return handleChatPreview(ctx, getDb(), owner.householdId, body);
}
```

`POST /documents/upload` — add `const limited = guard("2", owner.householdId, "POST /documents/upload"); if (limited) return limited;` after `assertHouseholdExists(...)` and before the multipart parse.

`POST /documents/:id/refresh` — add `const limited = guard("2", owner.householdId, "POST /documents/:id/refresh"); if (limited) return limited;` after `assertHouseholdExists(...)` and before `handleRefreshDocument(...)`.

`POST /connections/google-drive` — add `const limited = guard("2", owner.householdId, "POST /connections/google-drive"); if (limited) return limited;` after `assertHouseholdExists(...)` and before `handleConnectGoogleDrive(...)`.

- [ ] **Step 4.7: Wire Tier 3 global catch-all**

Tier 3 applies to every authenticated route *not* covered by Tier 2, plus `GET /join/:pin`. To keep the diff tight, add the guard once per route rather than centralizing — we want explicit security behavior at each route.

For `GET /join/:pin` (before `handleJoinPage` is called):

```ts
const joinParams = parsePathParams("/join/:pin", pathname);
if (method === "GET" && joinParams) {
  const limited = guard("3", clientIp, "GET /join/:pin");
  if (limited) return limited;
  const result = handleJoinPage(joinParams.pin, config.hearthstonePublicUrl);
  return new Response(result.body, {
    status: result.status,
    headers: { "Content-Type": result.contentType },
  });
}
```

For each of the following authenticated routes, insert `const limited = guard("3", clientIp, "<METHOD> <route>"); if (limited) return limited;` **before** the authentication call. Tier 3 is keyed on `clientIp`, which needs no auth — putting the guard first means unauthenticated attempts (token stuffing, scanning) are rate-limited too, and we avoid a DB/JWT round-trip when already throttled. Route labels match `matchRoute()` output:

- `GET /me`
- `PATCH /me`
- `POST /household`
- `PATCH /household`
- `DELETE /household`
- `GET /guests`
- `POST /guests`
- `POST /guests/:id/reinvite`
- `POST /guests/:id/revoke`
- `DELETE /guests/:id`
- `GET /household/owners`
- `POST /household/owners`
- `DELETE /household/owners/:id`
- `GET /connections`
- `GET /connections/:id/files`
- `DELETE /connections/:id`
- `GET /documents`
- `POST /documents`
- `GET /documents/:id/content`
- `DELETE /documents/:id`
- `GET /chat/suggestions`
- `GET /guest/documents`

Example (GET /me):

```ts
if (method === "GET" && pathname === "/me") {
  const limited = guard("3", clientIp, "GET /me");
  if (limited) return limited;
  const owner = await authenticateOwner(getDb(), req.headers.get("authorization"), config.jwtSecret);
  assertHouseholdExists(getDb(), owner.householdId);
  // ...existing handler...
}
```

**Do NOT** add Tier 3 to:
- `/` `/tos` `/privacy` (static, exempt)
- `/admin/*` (already token-gated, exempt)
- `/connections/google-drive/callback` (Google-originated, exempt)
- `/auth/pin/redeem` (covered by Tier 1)
- Tier 2 routes listed above

- [ ] **Step 4.8: Register admin rate-limit routes**

After the existing `GET /admin/info` block, add:

```ts
if (method === "GET" && pathname === "/admin/rate-limits") {
  if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
  const result = handleAdminRateLimits(rateLimiter);
  return json(result.body, result.status);
}

if (method === "POST" && pathname === "/admin/rate-limits/clear") {
  if (!requireAdmin(req)) return json({ message: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  const result = handleAdminClearRateLimit(rateLimiter, body);
  if (result.body === null) return new Response(null, { status: 204 });
  return json(result.body, result.status);
}
```

- [ ] **Step 4.9: Update `matchRoute()` for the two new admin routes**

In `matchRoute()`'s `staticRoutes` array, add:

```
"GET /admin/rate-limits",
"POST /admin/rate-limits/clear",
```

- [ ] **Step 4.10: Run the full test suite**

Run: `cd backend && bun test`
Expected: All existing tests still pass. `rate-limit.test.ts` and `rate-limit-integration.test.ts` pass.

- [ ] **Step 4.11: Start the dev server and smoke-test**

Run: `cd backend && bun run dev` (in one terminal)

In another:

```bash
# Tier 1: 11 redemptions of a bogus PIN, 11th should be 429
for i in 1 2 3 4 5 6 7 8 9 10 11; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/auth/pin/redeem \
    -H "content-type: application/json" \
    -H "fly-client-ip: 9.9.9.9" \
    -d '{"pin":"ABCDEF"}'
done
```

Expected: Ten `404` responses (PIN not found), one `429`.

- [ ] **Step 4.12: Commit**

```bash
git add backend/src/index.ts backend/tests/rate-limit-integration.test.ts
git commit -m "feat(rate-limit): wire tiered limits + admin routes into request handler"
```

---

## Task 5: Admin UI panel

**Files:**
- Modify: `backend/src/html/admin-page.ts`

- [ ] **Step 5.1: Add the Rate Limits section markup**

In `backend/src/html/admin-page.ts`, find the existing `<section>` block near the end of the body (the one containing the houses list). Immediately before the closing `</body>` tag, insert a new section:

```html
<section>
  <h2>Rate limits</h2>
  <div class="card">
    <div class="toolbar">
      <strong>Currently throttled</strong>
      <span id="rl-updated" style="color:#9b9488;font-size:0.82rem;"></span>
    </div>
    <table>
      <thead>
        <tr><th>Tier</th><th>Key</th><th>Tokens</th><th>Retry in</th><th class="row-actions-col"></th></tr>
      </thead>
      <tbody id="rl-throttled"></tbody>
    </table>
    <p id="rl-throttled-empty" style="color:#9b9488;padding:0.75rem 0.5rem;display:none;">No active throttles.</p>
  </div>

  <div class="card" style="margin-top:1rem;">
    <div class="toolbar"><strong>Recent rejections</strong></div>
    <table>
      <thead>
        <tr><th>Time</th><th>Route</th><th>Tier</th><th>Key</th><th>Retry</th></tr>
      </thead>
      <tbody id="rl-rejections"></tbody>
    </table>
    <p id="rl-rejections-empty" style="color:#9b9488;padding:0.75rem 0.5rem;display:none;">No recent rejections.</p>
  </div>
</section>
```

- [ ] **Step 5.2: Add the fetch + render + clear logic**

At the end of the existing admin-page `<script>` block (or in a new one appended before `</body>`), add:

```html
<script>
(function () {
  const throttledBody = document.getElementById("rl-throttled");
  const throttledEmpty = document.getElementById("rl-throttled-empty");
  const rejectionsBody = document.getElementById("rl-rejections");
  const rejectionsEmpty = document.getElementById("rl-rejections-empty");
  const updated = document.getElementById("rl-updated");

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
  }

  async function refresh() {
    try {
      const r = await fetch("/admin/rate-limits", { credentials: "same-origin" });
      if (!r.ok) return;
      const data = await r.json();
      const throttled = data.throttled || [];
      const rejections = data.rejections || [];

      throttledBody.innerHTML = throttled.map(t =>
        '<tr>' +
          '<td>' + t.tier + '</td>' +
          '<td>' + escapeHtml(t.key) + '</td>' +
          '<td>' + t.tokens + ' / ' + t.capacity + '</td>' +
          '<td>' + t.retry_after_seconds + 's</td>' +
          '<td class="row-actions-col"><button class="row-action" data-key="' + encodeURIComponent(t.key) + '">Clear</button></td>' +
        '</tr>'
      ).join('');
      throttledEmpty.style.display = throttled.length === 0 ? 'block' : 'none';

      rejectionsBody.innerHTML = rejections.map(e =>
        '<tr>' +
          '<td>' + fmtTime(e.ts) + '</td>' +
          '<td>' + escapeHtml(e.route) + '</td>' +
          '<td>' + e.tier + '</td>' +
          '<td>' + escapeHtml(e.key) + '</td>' +
          '<td>' + e.retry_after_seconds + 's</td>' +
        '</tr>'
      ).join('');
      rejectionsEmpty.style.display = rejections.length === 0 ? 'block' : 'none';

      updated.textContent = "updated " + new Date().toLocaleTimeString();
    } catch (err) {
      console.warn("rate-limits fetch failed", err);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button.row-action[data-key]");
    if (!btn) return;
    const key = decodeURIComponent(btn.getAttribute("data-key"));
    btn.disabled = true;
    try {
      await fetch("/admin/rate-limits/clear", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      refresh();
    } finally {
      btn.disabled = false;
    }
  });

  refresh();
  setInterval(refresh, 5000);
})();
</script>
```

If the existing admin page has a delegated click handler, verify the new selector (`button.row-action[data-key]`) doesn't collide. If it does, namespace the new button class (e.g., `button.rl-clear`) and adjust both markup and handler.

- [ ] **Step 5.3: Boot the server and verify the panel renders**

Run: `cd backend && bun run dev`

Open the printed admin URL. You should see a "Rate limits" section below the houses list, with "No active throttles." and "No recent rejections." placeholders.

Hammer the PIN redeem endpoint from a terminal (as in step 4.11) and watch the panel populate within 5s. Click **Clear** on the throttled row and confirm it vanishes.

- [ ] **Step 5.4: Commit**

```bash
git add backend/src/html/admin-page.ts
git commit -m "feat(rate-limit): admin panel for live throttles and recent rejections"
```

---

## Task 6: Docs

**Files:**
- Modify: `BACKLOG.md`
- Modify: `docs/decisions/decisions-security.md`

- [ ] **Step 6.1: Remove the rate-limiting entry from `BACKLOG.md`**

Delete the entire `## Rate limiting on /auth/pin/redeem` section and its surrounding blank line.

- [ ] **Step 6.2: Update `docs/decisions/decisions-security.md`**

Find the bullet:

```
- **An attacker tries to brute-force the PIN redeem endpoint.** Mitigation today: 30 bits of PIN entropy + 7-day TTL. Mitigation tomorrow: rate limiting on `/auth/pin/redeem` (deferred — see `BACKLOG.md`).
```

Replace with:

```
- **An attacker tries to brute-force the PIN redeem endpoint.** Mitigation: 30 bits of PIN entropy, 7-day TTL, and per-IP rate limiting (Tier 1: 10/min + 60/hr) on `POST /auth/pin/redeem`. See `backend/src/middleware/rate-limit.ts` and `docs/superpowers/specs/2026-04-16-rate-limiting-design.md`.
```

Find the paragraph in §PIN redemption that reads:

```
- **No rate limiting yet.** This is the most important known gap. Without it, an attacker doing 50 req/s would chew through the whole space in ~7 months. That's safe-ish in absolute terms, especially with 7-day TTLs cycling out PINs underneath them, but it's defense-in-depth we should build before scaling.
```

Replace with:

```
- **Rate limited.** `POST /auth/pin/redeem` is capped at 10 requests per minute and 60 per hour per client IP (resolved from `Fly-Client-IP` with `X-Forwarded-For` fallback). Over-budget requests get a `429` with `Retry-After` and `retry_after_seconds` in the JSON body. Rejections are logged to stderr and, if Honeycomb is configured, as span attributes. An admin panel at `/admin` shows currently-throttled keys with a Clear button.
```

- [ ] **Step 6.3: Commit**

```bash
git add BACKLOG.md docs/decisions/decisions-security.md
git commit -m "docs(rate-limit): close backlog entry and refresh security decisions"
```

---

## Final checks

- [ ] **Run the full test suite once more**

Run: `cd backend && bun test`
Expected: all green.

- [ ] **Run the iOS build to ensure nothing regressed (no iOS changes expected, but sanity-check)**

Run: `cd ios && xcodebuild -project Hearthstone.xcodeproj -scheme Hearthstone -destination 'platform=iOS Simulator,name=iPhone 17' build`
Expected: BUILD SUCCEEDED.

- [ ] **Verify in a fresh dev server session that the admin panel is functional**

Follow step 5.3 again from a clean state.
