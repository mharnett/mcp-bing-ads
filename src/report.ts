// Report polling loop, extracted from BingAdsManager so it can be unit tested
// (index.ts has import-time side effects and cannot be imported by tests).
//
// The Reporting API returns Status "Success" with no ReportDownloadUrl when a
// report contains zero rows. That must resolve to an empty result -- treating
// it as "not ready yet" makes the loop poll until it times out.

export interface ReportPollResult {
  status: string;
  url?: string;
}

export async function pollUntilReportReady(
  poll: () => Promise<ReportPollResult>,
  download: (url: string) => Promise<any[]>,
  maxWaitMs: number = 120000,
  pollIntervalMs: number = 2000,
): Promise<any[]> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const result = await poll();

    if (result.status === "Success") {
      if (!result.url) {
        // Zero-row report: Success with no ReportDownloadUrl
        return [];
      }
      return await download(result.url);
    }
    if (result.status === "Error") {
      throw new Error("Report generation failed");
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Report timed out after ${maxWaitMs}ms`);
}
