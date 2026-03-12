import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";

const EXPECTED_TOOL_NAMES = [
  "bing_ads_get_client_context",
  "bing_ads_list_campaigns",
  "bing_ads_get_campaign_performance",
  "bing_ads_list_ad_groups",
  "bing_ads_keyword_performance",
  "bing_ads_search_term_report",
  "bing_ads_pause_keywords",
  "bing_ads_list_shared_entities",
  "bing_ads_add_shared_negatives",
  "bing_ads_update_campaign_budget",
];

describe("Bing Ads MCP tools contract", () => {
  it("exports exactly the expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("all tools have bing_ads_ prefix", () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^bing_ads_/);
    }
  });

  it("all tools have a description", () => {
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  it("all inputSchema.type === 'object' with properties", () => {
    for (const tool of tools) {
      const schema = tool.inputSchema as any;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect(typeof schema.properties).toBe("object");
    }
  });

  it("all required fields exist in properties", () => {
    for (const tool of tools) {
      const schema = tool.inputSchema as any;
      const required: string[] = schema.required ?? [];
      const propertyNames = Object.keys(schema.properties);
      for (const field of required) {
        expect(propertyNames).toContain(field);
      }
    }
  });

  it("campaign_performance requires start_date and end_date", () => {
    const tool = tools.find((t) => t.name === "bing_ads_get_campaign_performance");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as any;
    expect(schema.required).toContain("start_date");
    expect(schema.required).toContain("end_date");
  });
});
