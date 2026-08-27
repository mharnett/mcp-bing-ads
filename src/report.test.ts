import { describe, it, expect } from "vitest";
import { pollUntilReportReady, ReportPollResult, buildReportScope } from "./report.js";

describe("pollUntilReportReady", () => {
  it("downloads and parses when Success with a download url", async () => {
    const rows = [{ CampaignName: "Weddings", Clicks: "12" }];
    let downloadedUrl: string | null = null;

    const result = await pollUntilReportReady(
      async () => ({ status: "Success", url: "https://example.com/report.csv" }),
      async (url) => {
        downloadedUrl = url;
        return rows;
      },
    );

    expect(result).toEqual(rows);
    expect(downloadedUrl).toBe("https://example.com/report.csv");
  });

  it("returns [] for a zero-row report (Success with no ReportDownloadUrl) instead of polling until timeout", async () => {
    // The Reporting API omits ReportDownloadUrl when the report has zero rows
    // (e.g. all campaigns paused for the requested date range). Before the fix
    // this kept polling until the maxWaitMs timeout.
    let polls = 0;
    let downloadCalled = false;

    const result = await pollUntilReportReady(
      async () => {
        polls++;
        return { status: "Success" };
      },
      async () => {
        downloadCalled = true;
        return [];
      },
      500, // maxWaitMs: if the zero-row case were treated as "not ready", this test would time out here
      10,
    );

    expect(result).toEqual([]);
    expect(polls).toBe(1);
    expect(downloadCalled).toBe(false);
  });

  it("keeps polling while Pending, then downloads on Success", async () => {
    const responses: ReportPollResult[] = [
      { status: "Pending" },
      { status: "Pending" },
      { status: "Success", url: "https://example.com/report.csv" },
    ];
    let polls = 0;

    const result = await pollUntilReportReady(
      async () => responses[polls++],
      async () => [{ ok: true }],
      1000,
      10,
    );

    expect(result).toEqual([{ ok: true }]);
    expect(polls).toBe(3);
  });

  it("throws when the report status is Error", async () => {
    await expect(() =>
      pollUntilReportReady(
        async () => ({ status: "Error" }),
        async () => [],
      ),
    ).rejects.toThrow("Report generation failed");
  });

  it("times out when the report never completes", async () => {
    await expect(() =>
      pollUntilReportReady(
        async () => ({ status: "Pending" }),
        async () => [],
        50,
        10,
      ),
    ).rejects.toThrow("Report timed out after 50ms");
  });
});

describe("buildReportScope", () => {
  // Bing's AccountThroughCampaignReportScope treats AccountIds and Campaigns as
  // MUTUALLY EXCLUSIVE. Sending both makes the account-wide scope win, so the
  // campaign filter is silently ignored and the report returns every campaign in
  // the account. Nothing errors — the caller just gets unfiltered rows back and
  // has no way to tell.
  //
  // Origin: 2026-08-26. bing_ads_keyword_performance(campaign_ids: ["607136146"])
  // returned 46 rows including bing_bofu_neon_crm_brand alongside the requested
  // bing_bofu_nonprofit_core. Caught only because brand keywords are obvious in a
  // nonprofit campaign's report; a filter between two similar campaigns would have
  // passed review. getSearchTermReport built the identical scope, so the search-term
  // review pipeline was affected too.

  it("scopes to the account when no campaign filter is given", () => {
    expect(buildReportScope("141522471")).toEqual({ AccountIds: [141522471] });
  });

  it("scopes to the account when the campaign list is empty", () => {
    expect(buildReportScope("141522471", [])).toEqual({ AccountIds: [141522471] });
  });

  it("omits AccountIds entirely when campaigns are given", () => {
    const scope = buildReportScope("141522471", ["607136146"]);
    expect(scope.AccountIds).toBeUndefined();
    expect(scope.Campaigns).toEqual([
      { AccountId: 141522471, CampaignId: 607136146 },
    ]);
  });

  it("maps every campaign id, as numbers", () => {
    const scope = buildReportScope("141522471", ["607136146", "410393396"]);
    expect(scope.Campaigns).toEqual([
      { AccountId: 141522471, CampaignId: 607136146 },
      { AccountId: 141522471, CampaignId: 410393396 },
    ]);
    expect(scope.Campaigns.every((c: any) => typeof c.CampaignId === "number")).toBe(true);
  });

  it("never returns both keys at once", () => {
    for (const ids of [undefined, [], ["1"], ["1", "2"]]) {
      const scope = buildReportScope("141522471", ids as string[] | undefined);
      const hasBoth = scope.AccountIds !== undefined && scope.Campaigns !== undefined;
      expect(hasBoth).toBe(false);
    }
  });
});
