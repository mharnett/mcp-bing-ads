/**
 * Test doubles for driving src/index.ts in-process without touching Microsoft.
 *
 * - FAKE_ENV: credentials long enough to pass validateCredentials() and an
 *   account/customer pair, so the BingAdsManager constructor at module load
 *   does not throw and resolveClient() finds a client. A test that forgets
 *   them fails at import instead of passing vacuously.
 * - createRecordingFetch(): a fetch stand-in that records every request and
 *   answers from a route function. It never calls the real fetch, so even
 *   with the write gate removed nothing reaches Microsoft Advertising.
 * - The token response carries no refresh_token, so the Keychain-persist
 *   branch never runs; callers also mock ./keychain.js.
 */

export const FAKE_ACCOUNT_ID = "100000001";
export const FAKE_CUSTOMER_ID = "200000002";

export const FAKE_ENV: Record<string, string> = {
  BING_ADS_DEVELOPER_TOKEN: "fake-developer-token-0001",
  BING_ADS_CLIENT_ID: "fake-client-id-0001",
  BING_ADS_REFRESH_TOKEN: "fake-refresh-token-0001",
  BING_ADS_ACCOUNT_ID: FAKE_ACCOUNT_ID,
  BING_ADS_CUSTOMER_ID: FAKE_CUSTOMER_ID,
};

export const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export const CAMPAIGN_MGMT_BASE = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";
export const REPORTING_BASE = "https://reporting.api.bingads.microsoft.com/Reporting/v13";

export interface RecordedRequest {
  method: string;
  url: string;
  /** The URL with the Campaign Management or Reporting base stripped. */
  path: string;
  body: any;
}

export type Route = (req: RecordedRequest) => { status: number; body: unknown };

const defaultRoute: Route = () => ({ status: 200, body: {} });

export function createRecordingFetch() {
  const tokenRequests: RecordedRequest[] = [];
  const apiRequests: RecordedRequest[] = [];
  let route: Route = defaultRoute;

  const fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    if (url === TOKEN_URL) {
      tokenRequests.push({ method, url, path: "", body: null });
      return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), { status: 200 });
    }
    const path = url.replace(CAMPAIGN_MGMT_BASE, "").replace(REPORTING_BASE, "");
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    const req = { method, url, path, body };
    apiRequests.push(req);
    const { status, body: resBody } = route(req);
    if (resBody instanceof Uint8Array) return new Response(resBody, { status });
    return new Response(JSON.stringify(resBody), { status });
  };

  return {
    fetch,
    tokenRequests,
    apiRequests,
    get total() {
      return tokenRequests.length + apiRequests.length;
    },
    setRoute(r: Route) {
      route = r;
    },
    reset() {
      tokenRequests.length = 0;
      apiRequests.length = 0;
      route = defaultRoute;
    },
  };
}
