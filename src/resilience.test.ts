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
      expect((result as any[]).length).toBeLessThan(largeArray.length);
    });

    it("should truncate large objects with items array", () => {
      const largeObj = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          id: i,
          data: "x".repeat(200),
        })),
      };
      const result = safeResponse(largeObj, "test");
      expect((result as any).items.length).toBeLessThan(5000);
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
      expect(attempts).toBeGreaterThan(1);
    });

    it("should fail after max retry attempts", async () => {
      const fn = async () => {
        throw new Error("Persistent failure");
      };

      await expect(() => withResilience(fn, "test-op")).rejects.toThrow(
        "Persistent failure"
      );
    });
  });
});
