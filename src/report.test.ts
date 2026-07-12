import { describe, it, expect } from "vitest";
import { pollUntilReportReady, ReportPollResult } from "./report.js";

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
