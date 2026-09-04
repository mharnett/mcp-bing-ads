import { describe, it, expect } from "vitest";
import {
  buildPauseKeywordsRequest,
  buildAddSharedNegativesRequest,
  buildUpdateCampaignBudgetRequest,
  buildUpdateAdGroupCpcBidRequest,
  assertAdGroupBidPrecondition,
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

// UpdateAdGroups -> PUT /AdGroups. Max CPC on this account lives at ad-group
// level as CpcBid.Amount (all 3 ad groups on bing_bofu_nonprofit_core read
// CpcBid: { Amount: 24 } live on 2026-09-03); there is no campaign-level max
// CPC to set. CampaignId travels in the body; AccountId/CustomerId are headers.
describe("buildUpdateAdGroupCpcBidRequest", () => {
  it("builds PUT /AdGroups carrying the ad group's CpcBid amount", () => {
    expect(buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", 10)).toEqual({
      path: "/AdGroups",
      method: "PUT",
      body: {
        CampaignId: 607136146,
        AdGroups: [{ Id: 1332610684483682, CpcBid: { Amount: 10 } }],
      },
    });
  });

  it("preserves a fractional bid rather than rounding it", () => {
    const req = buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", 2.75);
    expect((req.body.AdGroups as any[])[0].CpcBid).toEqual({ Amount: 2.75 });
  });

  it("rejects a non-positive bid", () => {
    expect(() => buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", 0)).toThrow(/positive/i);
    expect(() => buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", -5)).toThrow(/positive/i);
  });

  it("rejects a bid above the fat-finger ceiling", () => {
    // A bid is uncapped downstream: unlike a budget, an over-large value has no
    // daily ceiling to limit the damage. $500 is far above anything this account
    // has ever bid ($24 max) and exists only to catch a misplaced decimal.
    expect(() => buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", 1000)).toThrow(/ceiling|500/i);
  });

  it("rejects a non-finite bid", () => {
    expect(() => buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", NaN)).toThrow();
    expect(() => buildUpdateAdGroupCpcBidRequest("607136146", "1332610684483682", Infinity)).toThrow();
  });
});

// The guard update_campaign_budget lacks. A bid write is optimistic-concurrency
// sensitive: if the ad group is not where the caller believes, the new bid is
// being computed against stale state. Pure function so it is testable without
// the server, and REQUIRED at the call site rather than defaulted.
describe("assertAdGroupBidPrecondition", () => {
  const adGroups = [
    { Id: "1332610684483682", Name: "Donation Software", CpcBid: { Amount: 24 } },
    { Id: "1331511172090897", Name: "Nonprofit Software", CpcBid: { Amount: 24 } },
  ];

  it("passes when the live bid matches what the caller expected", () => {
    expect(() => assertAdGroupBidPrecondition(adGroups, "1332610684483682", 24)).not.toThrow();
  });

  it("throws naming both bids when the live bid has drifted", () => {
    expect(() => assertAdGroupBidPrecondition(adGroups, "1332610684483682", 12))
      .toThrow(/expected 12.*(found|actual|is) 24/i);
  });

  it("names the ad group, not just its id, so the error is actionable", () => {
    expect(() => assertAdGroupBidPrecondition(adGroups, "1332610684483682", 12))
      .toThrow(/Donation Software/);
  });

  it("throws when the ad group is not in the account response", () => {
    expect(() => assertAdGroupBidPrecondition(adGroups, "9999999999", 24)).toThrow(/not found/i);
  });

  it("throws rather than passing when the live bid is missing entirely", () => {
    // A null CpcBid must not compare equal to anything — failing open here
    // would defeat the whole guard.
    expect(() => assertAdGroupBidPrecondition(
      [{ Id: "1", Name: "No Bid", CpcBid: null }], "1", 24)).toThrow();
  });

  it("tolerates float representation error on an equal bid", () => {
    expect(() => assertAdGroupBidPrecondition(
      [{ Id: "1", Name: "Cents", CpcBid: { Amount: 2.7000000000000002 } }], "1", 2.7)).not.toThrow();
  });
});
