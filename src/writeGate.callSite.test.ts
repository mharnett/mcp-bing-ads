/**
 * Write gate at the call site: drives the real tools/list and tools/call
 * handlers that src/index.ts registers, over an in-memory MCP transport.
 *
 * writeGate.test.ts proves assertWriteAllowed() and filterTools() work, but
 * it imports only tools.js, so deleting either call from src/index.ts left
 * every test green (review 2026-11-14). Here every WRITE_TOOLS name is called
 * through the server with BING_ADS_MCP_WRITE unset and must be refused before
 * any request leaves the process.
 *
 * Containment: fetch is a recording fake (tests/helpers/fakeBingApi.ts) that
 * never calls the network, ./keychain.js is replaced so nothing reaches the
 * Keychain, and config.json is ignored so only the fake env is used.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { createRecordingFetch, FAKE_ACCOUNT_ID, FAKE_ENV } from "../tests/helpers/fakeBingApi.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";
import { WRITE_TOOLS, WRITE_DISABLED_MESSAGE } from "./writeGate.js";
import { tools } from "./tools.js";

vi.mock("./keychain.js", () => ({ persistSecretToKeychain: () => false }));
vi.mock("./config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./config.js")>();
  return { ...real, resolveConfig: (opts: any) => real.resolveConfig({ ...opts, exists: () => false }) };
});

const api = createRecordingFetch();
const WRITE_TOOL_NAMES = [...WRITE_TOOLS].sort();

/** The bare call, and a fully loaded one with every id, amount and list set. */
const ARG_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["bare", { account_id: FAKE_ACCOUNT_ID }],
  [
    "loaded",
    {
      account_id: FAKE_ACCOUNT_ID,
      campaign_id: "300",
      ad_group_id: "400",
      keyword_ids: ["500", "501"],
      shared_list_id: "600",
      keywords: [{ text: "free widgets", match_type: "Phrase" }],
      daily_budget: 50,
      cpc_bid: 2.5,
      expected_current_bid: 2.0,
    },
  ],
];

let client: Client;
let fetchCallsDuringImport = -1;

beforeAll(async () => {
  vi.stubGlobal("fetch", api.fetch);
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("BING_ADS_MCP_WRITE", undefined);
  const { server } = await import("./index.js");
  await new Promise((r) => setTimeout(r, 50));
  fetchCallsDuringImport = api.total;
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  api.reset();
});

afterEach(() => {
  vi.stubEnv("BING_ADS_MCP_WRITE", undefined);
});

it("importing index.js does not start the server or call Microsoft", () => {
  expect(fetchCallsDuringImport).toBe(0);
});

describe("write gate at the CallTool dispatch (BING_ADS_MCP_WRITE unset)", () => {
  it("covers the pause, negatives, budget and bid tools", () => {
    expect(WRITE_TOOL_NAMES.length).toBe(4);
  });

  describe.each(ARG_SHAPES)("%s arguments", (_shape, args) => {
    it.each(WRITE_TOOL_NAMES)("%s is refused before any Microsoft request", async (name) => {
      const result: any = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(bodyOf(result).message).toBe(`Tool "${name}" is a write operation. ${WRITE_DISABLED_MESSAGE}`);
      expect(api.total).toBe(0);
    });
  });

  it("hides every write tool from tools/list and keeps every read tool", async () => {
    const { tools: listed } = await client.listTools();
    const names = listed.map((t) => t.name);
    expect(names.filter((n) => WRITE_TOOLS.has(n))).toEqual([]);
    expect(names.sort()).toEqual(tools.map((t) => t.name).filter((n) => !WRITE_TOOLS.has(n)).sort());
  });

  it("still lets a read tool through to the API (the fake is on the dispatch path)", async () => {
    const result: any = await client.callTool({
      name: "bing_ads_list_campaigns",
      arguments: { account_id: FAKE_ACCOUNT_ID },
    });

    expect(result.isError).toBeFalsy();
    expect(api.apiRequests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /Campaigns/QueryByAccountId"]);
  });
});

describe("write gate open (BING_ADS_MCP_WRITE=true)", () => {
  beforeEach(() => {
    vi.stubEnv("BING_ADS_MCP_WRITE", "true");
  });

  it("lists every tool, write tools included", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("lets a write tool through to the API", async () => {
    const result: any = await client.callTool({
      name: "bing_ads_pause_keywords",
      arguments: { account_id: FAKE_ACCOUNT_ID, ad_group_id: "400", keyword_ids: ["500"] },
    });

    expect(result.isError).toBeFalsy();
    expect(api.apiRequests.map((r) => `${r.method} ${r.path}`)).toEqual(["PUT /Keywords"]);
  });
});
