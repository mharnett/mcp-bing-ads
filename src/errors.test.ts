import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BingAdsAuthError,
  BingAdsRateLimitError,
  BingAdsServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";

describe("classifyError", () => {
  it("returns BingAdsAuthError for status 401", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const result = classifyError(err);
    expect(result).toBeInstanceOf(BingAdsAuthError);
    expect(result.message.toLowerCase()).toContain("auth failed");
  });

  it("returns BingAdsAuthError for invalid_grant message", () => {
    const err = new Error("invalid_grant: token expired");
    const result = classifyError(err);
    expect(result).toBeInstanceOf(BingAdsAuthError);
  });

  it("returns BingAdsRateLimitError for status 429", () => {
    const err = Object.assign(new Error("Too many requests"), { status: 429 });
    const result = classifyError(err);
    expect(result).toBeInstanceOf(BingAdsRateLimitError);
    expect((result as BingAdsRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("returns BingAdsServiceError for status 500", () => {
    const err = Object.assign(new Error("Internal server error"), { status: 500 });
    const result = classifyError(err);
    expect(result).toBeInstanceOf(BingAdsServiceError);
    expect(result.message).toContain("server error");
  });

  it("passes through generic errors unchanged", () => {
    const err = Object.assign(new Error("Something else"), { status: 400 });
    const result = classifyError(err);
    expect(result).toBe(err);
    expect(result).not.toBeInstanceOf(BingAdsAuthError);
    expect(result).not.toBeInstanceOf(BingAdsRateLimitError);
    expect(result).not.toBeInstanceOf(BingAdsServiceError);
  });
});

describe("validateCredentials", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BING_ADS_DEVELOPER_TOKEN;
    delete process.env.BING_ADS_CLIENT_ID;
    delete process.env.BING_ADS_REFRESH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports missing env vars when none are set", () => {
    const result = validateCredentials();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("BING_ADS_DEVELOPER_TOKEN");
    expect(result.missing).toContain("BING_ADS_CLIENT_ID");
    expect(result.missing).toContain("BING_ADS_REFRESH_TOKEN");
  });

  it("returns valid when all env vars are present", () => {
    process.env.BING_ADS_DEVELOPER_TOKEN = "test-token";
    process.env.BING_ADS_CLIENT_ID = "test-client-id";
    process.env.BING_ADS_REFRESH_TOKEN = "test-refresh-token";
    const result = validateCredentials();
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});
