import {
  retry,
  circuitBreaker,
  wrap,
  handleAll,
  timeout,
  TimeoutStrategy,
  ExponentialBackoff,
  ConsecutiveBreaker,
} from "cockatiel";
import pino from "pino";

// ============================================
// LOGGER
// ============================================

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "test" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        singleLine: true,
        translateTime: "SYS:standard",
      },
    },
  }),
});

// ============================================
// SAFE RESPONSE (Response Size Limiting)
// ============================================

const MAX_RESPONSE_SIZE = 200_000; // 200KB

export function safeResponse<T>(data: T, context: string): T {
  const jsonStr = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(jsonStr, "utf-8");

  if (sizeBytes > MAX_RESPONSE_SIZE) {
    logger.warn(
      { sizeBytes, maxSize: MAX_RESPONSE_SIZE, context },
      `Response exceeds size limit, truncating`
    );

    // If it's an array, truncate
    if (Array.isArray(data)) {
      const truncated = (data as any[]).slice(0, Math.max(1, Math.floor((data as any[]).length * 0.5)));
      return truncated as T;
    }

    // If it's an object with items/results, truncate those
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, any>;
      for (const key of ["items", "results", "data", "rows"]) {
        if (Array.isArray(obj[key])) {
          obj[key] = obj[key].slice(0, Math.max(1, Math.floor(obj[key].length * 0.5)));
          return obj as T;
        }
      }
    }
  }

  return data;
}

// ============================================
// RETRY + CIRCUIT BREAKER + TIMEOUT
// ============================================

const backoff = new ExponentialBackoff({
  initialDelay: 100,
  maxDelay: 5_000,
});

// Individual policies
const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff,
});

const circuitBreakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 60_000, // 60s to attempt recovery
  breaker: new ConsecutiveBreaker(5), // Open after 5 consecutive failures
});

const timeoutPolicy = timeout(30_000, TimeoutStrategy.Cooperative);

// Combine policies: timeout -> circuit breaker -> retry
const policy = wrap(timeoutPolicy, circuitBreakerPolicy, retryPolicy);

// ============================================
// WRAPPED API CALL WITH LOGGING
// ============================================

export async function withResilience<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    logger.debug({ operation: operationName }, "Starting API call");

    const result = await policy.execute(() => fn());

    logger.debug({ operation: operationName }, "API call succeeded");
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error(
      { operation: operationName, error: error.message, stack: error.stack },
      "API call failed after retries"
    );
    throw error;
  }
}
