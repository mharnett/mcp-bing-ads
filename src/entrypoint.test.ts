/**
 * The built entrypoint still starts when run directly.
 *
 * src/index.ts only calls main() when it is the process entrypoint, so tests
 * can import it. This spawns `node dist/index.js` (the bin target) the way the
 * MCP client does and lists tools over stdio. If the main-module check ever
 * returned false in production, the server would exit silently and this
 * would fail.
 *
 * Containment: tests/fixtures/no-network.mjs is preloaded so every fetch in
 * the child rejects (Microsoft OAuth, the API and the report download), and the
 * credentials are fakes. The token never succeeds, so the Keychain-persist
 * branch cannot run.
 */

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { pathToFileURL } from "url";

import { FAKE_ENV } from "../tests/helpers/fakeBingApi.js";

const ROOT = resolve(__dirname, "..");

describe("built entrypoint (dist/index.js)", () => {
  it("starts and answers tools/list over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", pathToFileURL(resolve(ROOT, "tests/fixtures/no-network.mjs")).href, resolve(ROOT, "dist/index.js")],
      env: { ...getDefaultEnvironment(), ...FAKE_ENV },
      stderr: "ignore",
    });
    const client = new Client({ name: "entrypoint-test", version: "0.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("bing_ads_list_campaigns");
    } finally {
      await client.close();
    }
  }, 30_000);
});
