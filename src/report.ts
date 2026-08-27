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

/**
 * Build the report scope for a Bing Ads report request.
 *
 * Bing's AccountThroughCampaignReportScope treats `AccountIds` and `Campaigns` as
 * MUTUALLY EXCLUSIVE. If both are sent the account-wide scope wins: the campaign
 * filter is silently ignored, the request still succeeds, and the report comes
 * back containing every campaign in the account. There is no error and nothing in
 * the response marks the rows as unfiltered, so a caller that trusts the parameter
 * is quietly working with the wrong data set.
 *
 * Origin: 2026-08-26 — `bing_ads_keyword_performance` with campaign_ids for
 * bing_bofu_nonprofit_core returned bing_bofu_neon_crm_brand rows as well. Callers
 * had to filter client-side on CampaignId to get a correct answer.
 */
export function buildReportScope(
  accountId: string,
  campaignIds?: string[],
): { AccountIds?: number[]; Campaigns?: Array<{ AccountId: number; CampaignId: number }> } {
  const account = parseInt(accountId);
  if (campaignIds && campaignIds.length > 0) {
    return {
      Campaigns: campaignIds.map((id) => ({
        AccountId: account,
        CampaignId: parseInt(id),
      })),
    };
  }
  return { AccountIds: [account] };
}
