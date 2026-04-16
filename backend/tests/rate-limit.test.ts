import { describe, it, expect } from "bun:test";
import { createRateLimiter, LIMITS, resolveClientIp } from "../src/middleware/rate-limit";
import { rateLimited } from "../src/middleware/rate-limit";
import { handleAdminRateLimits, handleAdminClearRateLimit } from "../src/routes/admin";

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
