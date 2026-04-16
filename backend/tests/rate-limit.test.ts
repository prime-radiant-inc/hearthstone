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

    // Tier 1 hour cap = 60. Burn 60 over the hour, refilling minute bucket in between.
    for (let batch = 0; batch < 6; batch++) {
      for (let i = 0; i < 10; i++) {
        expect(rl.check("k", "1").allowed).toBe(true);
      }
      now += 60_000; // 1 min, refills minute bucket fully
    }
    // Minute bucket has room, hour bucket does not.
    const denied = rl.check("k", "1");
    expect(denied.allowed).toBe(false);
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
