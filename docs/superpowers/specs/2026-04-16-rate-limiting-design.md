# Rate limiting

**Status:** Design
**Date:** 2026-04-16
**Author:** Thoth (Bob c7072936 / Opus 4.7)

## Goal

Blanket rate-limit coverage across the Hearthstone API, with three different strategies matched to three different abuse shapes. Scaled to a hobby-project threat model: we're defending against casual abuse and bot scanners, not a motivated adversary.

The motivating risk is brute-forcing `POST /auth/pin/redeem`. 30 bits of PIN entropy means ~7 months to exhaust the space at 50 req/s — safe in absolute terms, but relying on entropy alone for an unauthenticated endpoint is thin. Rate limiting closes that gap cheaply and pulls in protection for expensive authenticated endpoints (`/chat`, uploads) as a side effect.

## Non-goals

- Distributed rate limiting. Hearthstone runs on one Fly machine. If we ever run more than one, this design must change.
- Persistence across restarts. Bucket state lives in process memory.
- Per-route tuning beyond the three tiers defined below.
- iOS countdown UI. The server returns `retry_after_seconds`; iOS displays the server-supplied `message` unchanged.
- Trusted-IP bypass.

## Architecture

One module, `backend/src/middleware/rate-limit.ts`, exporting a factory:

```ts
createRateLimiter({
  now?: () => number,       // clock injection for tests; defaults to Date.now
  onReject?: (event) => void,
}): {
  check(key: string, tier: Tier): Decision,
  admin(): { throttled: Throttled[], rejections: RejectionEvent[] },
  clear(key: string): void,
  sweep(): void,
}
```

A single module-level instance is constructed on boot. A `setInterval` runs `sweep()` every 5 minutes. The sweep is not started under `Bun.env.NODE_ENV === "test"`.

Route handlers in `backend/src/index.ts` call a small helper at the top of each guarded route:

```ts
const rejection = rateLimited(req, tier, key);
if (rejection) return rejection;
```

`rateLimited` builds the `Decision`, constructs the 429 response (or null), writes the OTel span attributes, and appends to the rejection log. It is the only place that knows about the HTTP shape.

No wrapper middleware — `index.ts`'s route table is the single hub, and explicit one-line annotations at each route read better than hidden middleware when the reader is auditing security behavior.

## Tiers

Every guarded route belongs to exactly one tier. Tiers do not stack.

| Tier | Purpose | Key | Budget | Routes |
|---|---|---|---|---|
| **1. Anti-enumeration** | Stop brute-force against the PIN space | client IP | 10/min + 60/hr | `POST /auth/pin/redeem` |
| **2. Cost control** | Bound OpenAI spend and expensive document work | `householdId` (resolved from owner JWT, guest session, or the `/chat` guest session — every Tier 2 route has an authenticated `householdId` available by the time `rateLimited()` is called) | 30/min + 300/hr | `POST /chat`, `POST /chat/preview`, `POST /documents/upload`, `POST /documents/:id/refresh`, `POST /connections/google-drive` |
| **3. Global catch-all** | Defense in depth against runaway clients and scanners | client IP | 300/min | All other authenticated routes; `GET /join/:pin` |
| **Exempt** | Either third-party-originated or already token-gated | — | — | `GET /`, `GET /tos`, `GET /privacy`, `GET /connections/google-drive/callback`, all `/admin/*` |

Exemption rationale:

- Static pages and the OAuth callback see no meaningful user traffic; L4 flood protection is Fly's job.
- The OAuth callback is hit by Google's retry infrastructure; per-IP throttling could drop legitimate retries.
- Admin routes are gated by the single in-memory admin token. If that leaks, rate limiting is not the problem.

## Client IP resolution

```
Fly-Client-IP || rightmost X-Forwarded-For || X-Real-IP || "unknown"
```

`Fly-Client-IP` is written by Fly's proxy from the actual TCP peer and is not attacker-spoofable inside the app. `X-Forwarded-For` is attacker-controlled on the left; the rightmost value is the one added by the edge closest to us. `"unknown"` is a single bucket used only when no header resolves — keeps malformed dev/test traffic from polluting a real IP's bucket.

## 429 response

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Content-Type: application/json

{
  "message": "Too many requests. Try again in 42 seconds.",
  "retry_after_seconds": 42
}
```

- `retry_after_seconds` = `ceil((1 - tokens) / refillPerSec)` against the first bucket that denied the request.
- `Retry-After` header mirrors the same integer (HTTP standard).
- `message` is human-readable and interpolates the integer so iOS can display it unchanged.

This shape is consistent across all three tiers. The existing error envelope (`{ message: "..." }`) is preserved; `retry_after_seconds` is additive.

## Token bucket

Each tier is one or more `{ capacity, refillPerSec }` buckets. A request must pass **all** of its tier's buckets. Tier 1 composes a minute bucket and an hour bucket on the same key; Tier 2 does the same with different numbers; Tier 3 has a single minute bucket.

| Tier | Buckets |
|---|---|
| 1 | `{ capacity: 10, refillPerSec: 10/60 }`, `{ capacity: 60, refillPerSec: 60/3600 }` |
| 2 | `{ capacity: 30, refillPerSec: 30/60 }`, `{ capacity: 300, refillPerSec: 300/3600 }` |
| 3 | `{ capacity: 300, refillPerSec: 300/60 }` |

On each hit:

1. For each bucket: `tokens = min(capacity, tokens + (now - lastRefill) * refillPerSec)`; `lastRefill = now`.
2. If every bucket has `tokens >= 1`: subtract 1 from each, return `{ allowed: true }`.
3. Otherwise, the first bucket with `tokens < 1` wins. Return `{ allowed: false, retryAfterSec: ceil((1 - tokens) / refillPerSec) }`.

### Storage

```ts
type Bucket = { tokens: number; lastRefill: number };
type Entry = { buckets: Bucket[]; tier: Tier; lastAccess: number };
const entries = new Map<string, Entry>();    // key = `${tier}:${keyValue}`
```

### GC

Two paths, both safe to run:

1. **Lazy prune on access.** After processing a hit, if every bucket is full (`tokens === capacity`) and `lastAccess` older than `maxWindow * 2`, delete the entry. (Full buckets are equivalent to a fresh one; keeping them is pure memory waste.)
2. **Periodic sweep.** Every 5 minutes, iterate entries and apply the same rule. A floor that runs even if a hot key never returns.

Under spoofed `X-Forwarded-For` at scale the Map could still grow, but `Fly-Client-IP` comes from the actual TCP peer and is what we read first — the spoofing vector is only reachable if Fly's proxy is bypassed, which isn't our surface.

## Admin view

New section on `/admin` titled **Rate limits**, rendered below the houses list.

**Endpoint:** `GET /admin/rate-limits`

```json
{
  "throttled": [
    {
      "tier": "1",
      "key": "1.2.3.4",
      "tokens": 0,
      "capacity": 10,
      "retry_after_seconds": 37
    }
  ],
  "rejections": [
    {
      "ts": "2026-04-16T19:14:22.031Z",
      "route": "POST /auth/pin/redeem",
      "tier": "1",
      "key": "1.2.3.4",
      "retry_after_seconds": 42
    }
  ]
}
```

- `throttled` lists every entry where any bucket currently has `tokens < 1`. `tokens` / `capacity` are from the tightest bucket.
- `rejections` is a ring buffer of the most recent 200 rejection events, oldest-overwritten. In memory, lost on restart.
- The admin page polls this endpoint every 5s while open.

**Endpoint:** `POST /admin/rate-limits/clear` with `{ "key": "1.2.3.4" }` — deletes all entries for that key across all tiers, returns `204`.

Each `throttled` row on the admin UI has a **Clear** button wired to this endpoint.

Empty states: "No active throttles." and "No recent rejections."

## Observability

**OpenTelemetry span attributes** on every rate-limit decision (allowed and rejected):

- `ratelimit.tier` — `"1" | "2" | "3"`
- `ratelimit.key` — raw key value (IP or household id; household ids are already in the DB and not sensitive)
- `ratelimit.allowed` — boolean
- `ratelimit.retry_after_seconds` — integer, set only when rejected

These go to Honeycomb via the existing tracer; no separate log path needed when tracing is configured.

**Structured stderr log on rejection only** (allowed requests are silent — too noisy):

```ts
console.warn(JSON.stringify({
  event: "rate_limit_rejected",
  ts: new Date().toISOString(),
  route, tier, key, retry_after_seconds,
}));
```

One line, JSON, visible via `fly logs | jq`. Fallback path when Honeycomb isn't configured.

## Failure modes

- **Exception inside `check()`.** Log loudly and fail **open** (allow the request). A broken limiter must not 500 the app. Wrap the helper body in try/catch with `console.error`.
- **Map unbounded growth.** Mitigated by periodic sweep + the fact that `Fly-Client-IP` comes from the TCP peer, not a client-controlled header.
- **setInterval leak on dev hot-reload.** Guard with `globalThis.__rateLimitSweep` so a re-import doesn't stack intervals.

## Testing

**Unit tests** — `backend/tests/rate-limit.test.ts`:

1. Token-bucket refill under a fake clock: 10 hits, wait 6s (1 token), 11th hit now allowed.
2. Capacity clamp: idle for 1h doesn't give us 600 tokens.
3. `retry_after_seconds` math: empty bucket with rate 10/60 gives `retryAfterSec = 6`.
4. Multi-bucket: if the hour bucket (60/hr) is empty, the minute bucket alone doesn't allow the request.
5. Key isolation: two distinct IPs don't share state.
6. `clear(key)` removes all tiers' buckets for that key.
7. Sweep removes entries with all buckets full and idle longer than `maxWindow * 2`.

**Integration test** — extension to `backend/tests/api-contract.test.ts` or a new file:

- Hammer `POST /auth/pin/redeem` 11 times from the same test client. Assert #11 returns 429, `Retry-After` header present, `retry_after_seconds` integer > 0, `message` includes the integer.
- Assert that a different IP (mocked via `Fly-Client-IP` header) is not throttled.

The existing contract test catalogs successful response shapes. 429 is an error response; we don't extend the contract test to cover it. The integration test above is what actually verifies the wiring.

## Configuration

Limits are code constants in `rate-limit.ts`, exported as a single `LIMITS` object for test introspection. Changing a limit requires a code change and redeploy — appropriate friction for a hobby app. If we ever need runtime tuning we'll add env overrides then.

## File-level layout

- `backend/src/middleware/rate-limit.ts` — limiter factory, `LIMITS`, types, `rateLimited(req, tier, key)` helper.
- `backend/src/routes/admin.ts` — handler additions: `handleAdminRateLimits`, `handleAdminClearRateLimit`.
- `backend/src/html/admin-page.ts` — markup additions for the live + rejections panels.
- `backend/src/index.ts` — instantiate the limiter once, start the sweep, wire `rateLimited(...)` at the top of each guarded route, register the two new admin routes.
- `backend/tests/rate-limit.test.ts` — unit tests.
- `backend/tests/api-contract.test.ts` (or a dedicated `rate-limit-integration.test.ts`) — integration test.

## After shipping

Update `docs/decisions/decisions-security.md` §PIN redemption to reflect that the deferred rate-limit work has landed, and `BACKLOG.md` to remove the rate-limiting entry.
