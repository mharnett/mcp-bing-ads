import { describe, it, expect } from "vitest";
import {
  buildPauseKeywordsRequest,
  buildAddSharedNegativesRequest,
  buildUpdateCampaignBudgetRequest,
} from "./mutationRequests.js";

// Anchors: exact request shapes per the Campaign Management v13 REST reference.
// UpdateKeywords -> PUT /Keywords; AddListItemsToSharedList -> POST /ListItems;
// UpdateCampaigns -> PUT /Campaigns. The pre-fix SOAP-style action paths
// (/Keywords/UpdateKeywords, /SharedListItems/Add, /Campaigns/Update) all 404
// against campaign.api.bingads.microsoft.com (observed live 2026-07-14).

describe("buildPauseKeywordsRequest", () => {
  it("builds PUT /Keywords with paused keyword objects", () => {
    expect(buildPauseKeywordsRequest("1332608749212450", ["83289219968021", "83426094970818"])).toEqual({
      path: "/Keywords",
      method: "PUT",
      body: {
        AdGroupId: "1332608749212450",
        Keywords: [
          { Id: 83289219968021, Status: "Paused" },
          { Id: 83426094970818, Status: "Paused" },
        ],
      },
    });
  });
});

describe("buildAddSharedNegativesRequest", () => {
  it("builds POST /ListItems with NegativeKeyword items, defaulting to Phrase", () => {
    expect(buildAddSharedNegativesRequest("7001091971", [
      { text: "free crm" },
      { text: "crm jobs", match_type: "Exact" },
    ])).toEqual({
      path: "/ListItems",
      method: "POST",
      body: {
        SharedList: { Id: 7001091971, Type: "NegativeKeywordList" },
        ListItems: [
          { Type: "NegativeKeyword", Text: "free crm", MatchType: "Phrase" },
          { Type: "NegativeKeyword", Text: "crm jobs", MatchType: "Exact" },
        ],
      },
    });
  });
});

describe("buildUpdateCampaignBudgetRequest", () => {
  it("builds PUT /Campaigns carrying the daily budget", () => {
    expect(buildUpdateCampaignBudgetRequest("141522471", "410393396", 262)).toEqual({
      path: "/Campaigns",
      method: "PUT",
      body: {
        AccountId: "141522471",
        Campaigns: [
          { Id: 410393396, DailyBudget: 262, BudgetType: "DailyBudgetStandard" },
        ],
      },
    });
  });
});

describe("request shape invariants", () => {
  const all = [
    buildPauseKeywordsRequest("1", ["2"]),
    buildAddSharedNegativesRequest("3", [{ text: "x" }]),
    buildUpdateCampaignBudgetRequest("4", "5", 6),
  ];

  it("paths are relative resource roots — no host, no SOAP action suffix", () => {
    for (const req of all) {
      expect(req.path).toMatch(/^\/[A-Za-z]+$/);
      expect(req.path).not.toMatch(/Update|Add|Delete|Query/);
    }
  });

  it("updates are PUT, adds are POST", () => {
    expect(buildPauseKeywordsRequest("1", ["2"]).method).toBe("PUT");
    expect(buildUpdateCampaignBudgetRequest("4", "5", 6).method).toBe("PUT");
    expect(buildAddSharedNegativesRequest("3", [{ text: "x" }]).method).toBe("POST");
  });
});
