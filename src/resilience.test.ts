import { describe, it, expect } from "vitest";
import { withResilience, safeResponse } from "../src/resilience";

describe("Resilience", () => {
  describe("safeResponse", () => {
    it("should return data unchanged if under size limit", () => {
      const data = { name: "test", count: 100 };
      const result = safeResponse(data, "test");
      expect(result).toEqual(data);
    });

    it("wraps a truncated top-level array with a visible marker and both counts", () => {
      // ~600KB: three times the limit, the shape a large Bing report returns.
      const largeArray = Array.from({ length: 4000 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: "x".repeat(120),
      }));
      expect(Buffer.byteLength(JSON.stringify(largeArray))).toBeGreaterThan(550_000);

      const result = safeResponse(largeArray, "test") as any;

      expect(Array.isArray(result)).toBe(false);
      expect(result.truncated).toBe(true);
      expect(result.original_count).toBe(4000);
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.returned_count).toBe(result.rows.length);
      expect(result.returned_count).toBeGreaterThanOrEqual(1);
      expect(result.returned_count).toBeLessThanOrEqual(2000);
      // Rows kept are the leading rows, unchanged.
      expect(result.rows[0]).toEqual(largeArray[0]);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(200_000);
    });

    it("does not mutate the caller's array when truncating", () => {
      const largeArray = Array.from({ length: 4000 }, (_, i) => ({ id: i, d: "x".repeat(120) }));
      safeResponse(largeArray, "test");
      expect(largeArray.length).toBe(4000);
    });

    it("returns a small top-level array unchanged (no wrapper)", () => {
      const rows = [{ id: 1 }, { id: 2 }];
      expect(safeResponse(rows, "test")).toEqual(rows);
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
