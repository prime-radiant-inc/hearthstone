import { describe, it, expect, beforeEach } from "bun:test";
import { mintAdminToken } from "../src/services/admin-token";
import { requireAdmin } from "../src/middleware/admin-auth";

describe("requireAdmin", () => {
  let token: string;
  beforeEach(() => {
    token = mintAdminToken();
  });

  it("accepts a valid cookie", () => {
    const req = new Request("http://x/admin", { headers: { cookie: `hadm=${token}` } });
    expect(requireAdmin(req)).toBe(true);
  });

  it("accepts a valid bearer", () => {
    const req = new Request("http://x/admin", { headers: { authorization: `Bearer ${token}` } });
    expect(requireAdmin(req)).toBe(true);
  });

  it("rejects wrong cookie", () => {
    const req = new Request("http://x/admin", { headers: { cookie: "hadm=hadm_nope" } });
    expect(requireAdmin(req)).toBe(false);
  });

  it("rejects no auth", () => {
    const req = new Request("http://x/admin");
    expect(requireAdmin(req)).toBe(false);
  });
});
