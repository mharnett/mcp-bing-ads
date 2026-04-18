import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";
import {
  WRITE_TOOLS,
  isWriteTool,
  isWriteEnabled,
  filterTools,
  assertWriteAllowed,
  WRITE_DISABLED_MESSAGE,
} from "./writeGate.js";

const READ_TOOLS = [
  "bing_ads_get_client_context",
  "bing_ads_list_campaigns",
  "bing_ads_get_campaign_performance",
  "bing_ads_list_ad_groups",
  "bing_ads_keyword_performance",
  "bing_ads_search_term_report",
  "bing_ads_list_shared_entities",
];

describe("writeGate", () => {
  describe("tool classification covers every registered tool", () => {
    it("every tool is either in WRITE_TOOLS or in the READ_TOOLS fixture", () => {
      const registered = tools.map((t) => t.name);
      const classified = new Set<string>([...WRITE_TOOLS, ...READ_TOOLS]);
      const uncovered = registered.filter((n) => !classified.has(n));
      expect(uncovered).toEqual([]);
    });

    it("WRITE_TOOLS and READ_TOOLS do not overlap", () => {
      const overlap = READ_TOOLS.filter((n) => WRITE_TOOLS.has(n));
      expect(overlap).toEqual([]);
    });
  });

  describe("isWriteEnabled", () => {
    it("defaults to false when env var is unset", () => {
      expect(isWriteEnabled({})).toBe(false);
    });

    it("accepts 'true' (case-insensitive) as enabled", () => {
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "true" })).toBe(true);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "TRUE" })).toBe(true);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "True" })).toBe(true);
    });

    it("accepts '1' and 'yes' as enabled", () => {
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "1" })).toBe(true);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "yes" })).toBe(true);
    });

    it("rejects anything else", () => {
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "" })).toBe(false);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "false" })).toBe(false);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "0" })).toBe(false);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "no" })).toBe(false);
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "maybe" })).toBe(false);
    });

    it("trims whitespace", () => {
      expect(isWriteEnabled({ BING_ADS_MCP_WRITE: "  true  " })).toBe(true);
    });
  });

  describe("filterTools (read-only default)", () => {
    it("hides every write tool when the env var is unset", () => {
      const filtered = filterTools(tools, {});
      const names = filtered.map((t) => t.name);
      for (const w of WRITE_TOOLS) {
        expect(names).not.toContain(w);
      }
    });

    it("keeps every read tool when the env var is unset", () => {
      const filtered = filterTools(tools, {});
      const names = filtered.map((t) => t.name);
      for (const r of READ_TOOLS) {
        expect(names).toContain(r);
      }
    });

    it("exposes every tool when BING_ADS_MCP_WRITE=true", () => {
      const filtered = filterTools(tools, { BING_ADS_MCP_WRITE: "true" });
      expect(filtered.map((t) => t.name).sort()).toEqual(
        tools.map((t) => t.name).sort(),
      );
    });
  });

  describe("assertWriteAllowed", () => {
    it("permits read tools regardless of env var", () => {
      expect(() => assertWriteAllowed("bing_ads_list_campaigns", {})).not.toThrow();
      expect(() => assertWriteAllowed("bing_ads_keyword_performance", {})).not.toThrow();
    });

    it("blocks every write tool when env var is unset", () => {
      for (const w of WRITE_TOOLS) {
        expect(() => assertWriteAllowed(w, {})).toThrow(/write operation/i);
      }
    });

    it("allows write tools when BING_ADS_MCP_WRITE=true", () => {
      for (const w of WRITE_TOOLS) {
        expect(() =>
          assertWriteAllowed(w, { BING_ADS_MCP_WRITE: "true" }),
        ).not.toThrow();
      }
    });

    it("error message points at the env var fix", () => {
      try {
        assertWriteAllowed("bing_ads_pause_keywords", {});
      } catch (err) {
        expect((err as Error).message).toContain("BING_ADS_MCP_WRITE=true");
        return;
      }
      throw new Error("expected assertWriteAllowed to throw");
    });
  });

  describe("isWriteTool", () => {
    it("returns true for pause_keywords", () => {
      expect(isWriteTool("bing_ads_pause_keywords")).toBe(true);
    });

    it("returns false for read-only tools", () => {
      expect(isWriteTool("bing_ads_list_campaigns")).toBe(false);
      expect(isWriteTool("bing_ads_keyword_performance")).toBe(false);
    });
  });

  it("WRITE_DISABLED_MESSAGE mentions the env var", () => {
    expect(WRITE_DISABLED_MESSAGE).toContain("BING_ADS_MCP_WRITE=true");
  });
});
