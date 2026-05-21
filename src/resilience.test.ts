import { describe, it, expect } from "vitest";
import { withResilience, safeResponse } from "../src/resilience";

describe("Resilience", () => {
  describe("safeResponse", () => {
    it("should return data unchanged if under size limit", () => {
      const data = { name: "test", count: 100 };
      const result = safeResponse(data, "test");
      expect(result).toEqual(data);
    });

    it("should truncate large arrays", () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: "x".repeat(100),
      }));
      const result = safeResponse(largeArray, "test");
      expect(Array.isArray(result)).toBe(true);
      // After halving passes the array must be strictly smaller than half the input
      // (at least one halving pass), and must retain at least 1 element.
      expect((result as any[]).length).toBeGreaterThanOrEqual(1);
      expect((result as any[]).length).toBeLessThanOrEqual(largeArray.length / 2);
    });

    it("should truncate large objects with items array", () => {
      const largeObj = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          id: i,
          data: "x".repeat(200),
        })),
      };
      const result = safeResponse(largeObj, "test");
      expect((result as any).items.length).toBeGreaterThanOrEqual(1);
      expect((result as any).items.length).toBeLessThanOrEqual(2500);
      expect((result as any).truncated).toBe(true);
    });
  });

  describe("withResilience", () => {
    it("should execute successfully on first attempt", async () => {
      const fn = async () => ({ success: true });
      const result = await withResilience(fn, "test-op");
      expect(result).toEqual({ success: true });
    });

    it("should retry on transient failures", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new Error("Temporary failure");
        return { success: true };
      };

      const result = await withResilience(fn, "test-op");
      expect(result).toEqual({ success: true });
      // maxAttempts: 3 means up to 3 retries; this fn succeeds on attempt 2.
      expect(attempts).toBe(2);
    });

    it("should fail after max retry attempts", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error("Persistent failure");
      };

      await expect(() => withResilience(fn, "test-op")).rejects.toThrow(
        "Persistent failure"
      );
      // 1 initial + 3 retries (maxAttempts: 3) = 4 total attempts.
      expect(attempts).toBe(4);
    });
  });
});
