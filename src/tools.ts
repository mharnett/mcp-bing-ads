import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "bing_ads_get_client_context",
    description: "Get the current client context and health status based on working directory. Call this first to confirm which Bing Ads account you're working with.",
    inputSchema: {
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to list ad groups for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "bing_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score. Optionally filter by campaign.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with matched keywords and performance metrics.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by numeric string campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_pause_keywords",
    description: "Pause one or more keywords by setting their status to Paused. Requires ad group ID and keyword IDs.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "The account ID (uses context if not provided)" },
        ad_group_id: { type: "string", description: "The ad group containing the keywords" },
        keyword_ids: { type: "array", items: { type: "string" }, description: "Array of keyword IDs to pause" },
      },
      required: ["ad_group_id", "keyword_ids"],
    },
  },
  {
    name: "bing_ads_list_shared_entities",
    description: "List shared negative keyword lists (SharedEntity type) for the account. Returns list IDs and names needed for adding negatives.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "The account ID (uses context if not provided)" },
        entity_type: { type: "string", description: "Entity type, defaults to NegativeKeywordList", default: "NegativeKeywordList" },
      },
    },
  },
  {
    name: "bing_ads_add_shared_negatives",
    description: "Add negative keywords to a shared negative keyword list. Use phrase match by default (wrap in quotes). Call bing_ads_list_shared_entities first to get list IDs.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "The account ID (uses context if not provided)" },
        shared_list_id: { type: "string", description: "The shared negative keyword list ID to add negatives to" },
        keywords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "The negative keyword text" },
              match_type: { type: "string", enum: ["Exact", "Phrase"], description: "Match type (default: Phrase)" },
            },
            required: ["text"],
          },
          description: "Array of negative keywords to add",
        },
      },
      required: ["shared_list_id", "keywords"],
    },
  },
  {
    name: "bing_ads_update_campaign_budget",
    description: "Update a campaign's daily budget amount. Use bing_ads_list_campaigns first to get the campaign ID and current budget.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        account_id: { type: "string", description: "The account ID (uses context if not provided)" },
        campaign_id: { type: "string", description: "The numeric string campaign ID to update" },
        daily_budget: { type: "number", description: "New daily budget in dollars (e.g. 50.00 for $50/day)" },
      },
      required: ["campaign_id", "daily_budget"],
    },
  },
];
