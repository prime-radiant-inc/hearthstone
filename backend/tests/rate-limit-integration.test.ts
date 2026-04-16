import "./helpers"; // sets env vars before any app import

import { describe, it, expect } from "bun:test";
import { createRateLimiter, rateLimited } from "../src/middleware/rate-limit";

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
    const res = rateLimited(rl, req("9.9.9.9"), "1", "9.9.9.9", "POST /auth/pin/redeem");
    expect(res).toBeNull();
  });
});
