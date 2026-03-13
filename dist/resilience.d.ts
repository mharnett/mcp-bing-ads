export declare const logger: import("pino").Logger<never>;
export declare function safeResponse<T>(data: T, context: string): T;
export declare function withResilience<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
