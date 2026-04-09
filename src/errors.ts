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
  // Basic format validation: credentials should have reasonable length > 10 chars
  const malformed = required.filter(
    (key) => process.env[key] && process.env[key]!.trim().length > 0 && process.env[key]!.trim().length < 10,
  );
  if (malformed.length > 0) {
    missing.push(...malformed.map(k => `${k} (format: too short, expected length > 10)`));
  }
  return { valid: missing.length === 0, missing };
}

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const status = error?.status;
  // Check response body for error objects (SOAP API can return errors in body)
  const bodyError = error?.response?.body?.error || error?.data?.error || error?.errors?.[0];

  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_grant") ||
    message.includes("OAuth token refresh failed") ||
    message.includes("AuthenticationTokenExpired") ||
    message.includes("InvalidCredentials") ||
    bodyError?.code === "AuthenticationTokenExpired"
  ) {
    return new BingAdsAuthError(
      `Bing Ads auth failed: ${message}. Refresh token may be expired. Run 'node get-refresh-token.cjs' and update your BING_ADS_REFRESH_TOKEN environment variable.` +
      (process.platform === "darwin" ? ` On macOS: security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w '<token>' -U` : ""),
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
