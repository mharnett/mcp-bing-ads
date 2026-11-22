/**
 * A report tool end to end through the server: submit, poll, download the
 * ZIP, parse the CSV. reportCsv.test.ts covers the parser's edge cases; this
 * proves BingAdsManager actually routes the download through it.
 *
 * Containment: same recording fetch, keychain and config fakes as
 * writeGate.callSite.test.ts. Nothing reaches Microsoft Advertising.
 */

import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { deflateRawSync } from "zlib";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV } from "../tests/helpers/fakeBingApi.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";

vi.mock("./keychain.js", () => ({ persistSecretToKeychain: () => false }));
vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, resolveConfig: (opts: any) => real.resolveConfig({ ...opts, exists: () => false }) };
});

const api = createRecordingFetch();
let client: Client;
const DOWNLOAD_URL = "https://download.example.invalid/report-r1.zip";

function deflatedZip(content: string): Uint8Array {
  const raw = Buffer.from(content, "utf-8");
  const data = deflateRawSync(raw);
  const name = Buffer.from("r1.csv");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  return new Uint8Array(Buffer.concat([header, name, data]));
}

beforeAll(async () => {
  vi.stubGlobal("fetch", api.fetch);
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  const { server } = await import("./index.js");
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("bing_ads_get_campaign_performance returns the rows parsed from the downloaded ZIP", async () => {
  const csv = '"CampaignId","CampaignName","Spend"\r\n"300","Brand, US","45.67"\r\n';
  api.setRoute((req) => {
    if (req.path === "/GenerateReport/Submit") return { status: 200, body: { ReportRequestId: "r1" } };
    if (req.path === "/GenerateReport/Poll") {
      return { status: 200, body: { ReportRequestStatus: { Status: "Success", ReportDownloadUrl: DOWNLOAD_URL } } };
    }
    if (req.url === DOWNLOAD_URL) return { status: 200, body: deflatedZip(csv) };
    return { status: 404, body: {} };
  });

  const result: any = await client.callTool({
    name: "bing_ads_get_campaign_performance",
    arguments: { account_id: FAKE_ACCOUNT_ID, start_date: "2026-11-01", end_date: "2026-11-07" },
  });

  expect(result.isError).toBeFalsy();
  expect(bodyOf(result)).toEqual([{ CampaignId: 300, CampaignName: "Brand, US", Spend: 45.67 }]);
  expect(api.apiRequests.map((r) => r.path)).toEqual(["/GenerateReport/Submit", "/GenerateReport/Poll", DOWNLOAD_URL]);
  expect(api.apiRequests[0].body.ReportRequest.Scope).toEqual({ AccountIds: [Number(FAKE_ACCOUNT_ID)] });
});

it("parses a downloaded ZIP whose sizes are in a data descriptor", async () => {
  const zip = new Uint8Array(readFileSync(resolve(__dirname, "../tests/fixtures/report-data-descriptor.zip")));
  api.setRoute((req) => {
    if (req.path === "/GenerateReport/Submit") return { status: 200, body: { ReportRequestId: "r2" } };
    if (req.path === "/GenerateReport/Poll") {
      return { status: 200, body: { ReportRequestStatus: { Status: "Success", ReportDownloadUrl: DOWNLOAD_URL } } };
    }
    if (req.url === DOWNLOAD_URL) return { status: 200, body: zip };
    return { status: 404, body: {} };
  });

  const result: any = await client.callTool({
    name: "bing_ads_get_campaign_performance",
    arguments: { account_id: FAKE_ACCOUNT_ID, start_date: "2026-11-20", end_date: "2026-11-20" },
  });

  expect(result.isError).toBeFalsy();
  expect(bodyOf(result).map((r: any) => [r.CampaignId, r.Spend])).toEqual([
    [300, 45.67],
    [301, 3.1],
  ]);
});
