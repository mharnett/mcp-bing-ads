export declare class BingAdsAuthError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
export declare class BingAdsRateLimitError extends Error {
    readonly retryAfterMs: number;
    constructor(retryAfterMs: number, cause?: unknown);
}
export declare class BingAdsServiceError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
export declare function validateCredentials(): {
    valid: boolean;
    missing: string[];
};
export declare function classifyError(error: any): Error;
