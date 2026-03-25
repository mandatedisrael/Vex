import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, getClientIp } from "../../agent/rate-limit.js";

describe("checkRateLimit", () => {
  // Use unique IP + endpoint per test to avoid cross-contamination
  let testCounter = 0;
  const uniqueIp = () => `test-ip-${++testCounter}`;

  it("allows first request", () => {
    expect(checkRateLimit(uniqueIp(), "/api/test", 5, 60_000)).toBe(true);
  });

  it("allows requests within limit", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, "/api/test", 5, 60_000)).toBe(true);
    }
  });

  it("denies requests exceeding limit", () => {
    const ip = uniqueIp();
    // Use up the limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(ip, "/api/test", 5, 60_000);
    }
    // 6th request should be denied
    expect(checkRateLimit(ip, "/api/test", 5, 60_000)).toBe(false);
  });

  it("resets after window expires", async () => {
    const ip = uniqueIp();
    // Fill the bucket with a very short window
    for (let i = 0; i < 3; i++) {
      checkRateLimit(ip, "/api/test", 3, 50);
    }
    expect(checkRateLimit(ip, "/api/test", 3, 50)).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));
    expect(checkRateLimit(ip, "/api/test", 3, 50)).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const ip1 = uniqueIp();
    const ip2 = uniqueIp();
    // Fill ip1's bucket
    for (let i = 0; i < 2; i++) checkRateLimit(ip1, "/api/test", 2, 60_000);
    expect(checkRateLimit(ip1, "/api/test", 2, 60_000)).toBe(false);
    // ip2 should still be allowed
    expect(checkRateLimit(ip2, "/api/test", 2, 60_000)).toBe(true);
  });

  it("tracks different endpoints independently", () => {
    const ip = uniqueIp();
    for (let i = 0; i < 2; i++) checkRateLimit(ip, "/api/a", 2, 60_000);
    expect(checkRateLimit(ip, "/api/a", 2, 60_000)).toBe(false);
    expect(checkRateLimit(ip, "/api/b", 2, 60_000)).toBe(true);
  });
});

describe("getClientIp", () => {
  it("returns remote address for non-localhost", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("trusts x-forwarded-for from 127.0.0.1", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("trusts x-forwarded-for from ::1", () => {
    const req = {
      headers: { "x-forwarded-for": "9.8.7.6" },
      socket: { remoteAddress: "::1" },
    };
    expect(getClientIp(req)).toBe("9.8.7.6");
  });

  it("trusts x-forwarded-for from ::ffff:127.0.0.1", () => {
    const req = {
      headers: { "x-forwarded-for": "1.1.1.1" },
      socket: { remoteAddress: "::ffff:127.0.0.1" },
    };
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("ignores x-forwarded-for from external address (untrusted)", () => {
    const req = {
      headers: { "x-forwarded-for": "spoofed.ip" },
      socket: { remoteAddress: "203.0.113.50" },
    };
    expect(getClientIp(req)).toBe("203.0.113.50");
  });

  it("returns 'unknown' when no socket", () => {
    const req = { headers: {} };
    expect(getClientIp(req)).toBe("unknown");
  });
});
