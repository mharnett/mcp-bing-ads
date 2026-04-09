// ============================================
// TYPED ERRORS (mirrors motion-mcp pattern)
// ============================================

export class BingAdsAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BingAdsAuthError";
  }
}

export class BingAdsRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`Bing Ads rate limited, retry after ${retryAfterMs}ms`);
    this.name = "BingAdsRateLimitError";
    this.cause = cause;
  }
}

export class BingAdsServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BingAdsServiceError";
  }
}

// ============================================
// STARTUP CREDENTIAL VALIDATION
// ============================================

export function validateCredentials(): { valid: boolean; missing: string[] } {
  const required = [
    "BING_ADS_DEVELOPER_TOKEN",
    "BING_ADS_CLIENT_ID",
    "BING_ADS_REFRESH_TOKEN",
  ];
  const missing = required.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );
  return { valid: missing.length === 0, missing };
}

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const status = error?.status;

  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_grant") ||
    message.includes("OAuth token refresh failed") ||
    message.includes("AuthenticationTokenExpired") ||
    message.includes("InvalidCredentials")
  ) {
    return new BingAdsAuthError(
      `Bing Ads auth failed: ${message}. Refresh token may be expired. Re-authenticate and update Keychain.`,
      error,
    );
  }

  if (status === 429 || message.includes("RateLimit") || message.includes("CallRateExceeded")) {
    const retryMs = 60_000;
    return new BingAdsRateLimitError(retryMs, error);
  }

  if (status >= 500 || message.includes("InternalError")) {
    return new BingAdsServiceError(`Bing Ads API server error: ${message}`, error);
  }

  return error;
}
