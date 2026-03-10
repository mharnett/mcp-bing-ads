import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "bing_ads_get_client_context",
    description: "Get the current client context based on working directory. Call this first to confirm which Bing Ads account you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "bing_ads_list_campaigns",
    description: "List all campaigns for the current client's Bing/Microsoft Advertising account, including campaign name, status, budget, and type.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The account ID (uses context if not provided)",
        },
      },
    },
  },
  {
    name: "bing_ads_get_campaign_performance",
    description: "Get campaign performance metrics (impressions, clicks, CTR, CPC, spend, conversions, revenue) for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_list_ad_groups",
    description: "List ad groups within a specific campaign, including ad group name and status.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to list ad groups for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "bing_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score. Optionally filter by campaign.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with matched keywords and performance metrics.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
];
