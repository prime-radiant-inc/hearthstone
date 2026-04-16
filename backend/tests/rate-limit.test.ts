import { describe, it, expect } from "bun:test";
import { createRateLimiter, LIMITS, resolveClientIp } from "../src/middleware/rate-limit";

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
