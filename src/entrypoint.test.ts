/**
 * The built entrypoint still starts when run directly.
 *
 * src/index.ts only calls main() when it is the process entrypoint, so tests
 * can import it. This spawns `node dist/index.js` (the bin target) the way the
 * MCP client does and lists tools over stdio. If the main-module check ever
 * returned false in production, the server would exit silently and this
 * would fail. The second case starts it through a node_modules/.bin symlink,
 * which is how npx launches the bin.
 *
 * Containment: tests/fixtures/no-network.mjs is preloaded so every fetch in
 * the child rejects (Microsoft OAuth, the API and the report download), and the
 * credentials are fakes. The token never succeeds, so the Keychain-persist
 * branch cannot run.
 */

import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";

import { FAKE_ENV } from "../tests/helpers/fakeBingApi.js";

const ROOT = resolve(__dirname, "..");

/** Spawn `node <entry>` with the no-network preload and list the tools it serves. */
async function listToolsVia(entry: string): Promise<string[]> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", pathToFileURL(resolve(ROOT, "tests/fixtures/no-network.mjs")).href, entry],
    env: { ...getDefaultEnvironment(), ...FAKE_ENV },
    stderr: "ignore",
  });
  const client = new Client({ name: "entrypoint-test", version: "0.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}

describe("built entrypoint (dist/index.js)", () => {
  it("starts and answers tools/list over stdio", async () => {
    expect(await listToolsVia(resolve(ROOT, "dist/index.js"))).toContain("bing_ads_list_campaigns");
  }, 30_000);

  // npx and a global install run the bin through a symlink in
  // node_modules/.bin, so process.argv[1] is the link, not dist/index.js. The
  // main-module check must resolve it. npm on Windows uses a .cmd shim that
  // passes the real path (the case above), and creating a symlink there needs
  // extra privileges, so this runs on POSIX only.
  it.skipIf(process.platform === "win32")("starts through a node_modules/.bin symlink, the way npx runs it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-bing-ads-bin-"));
    try {
      mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
      const link = join(dir, "node_modules", ".bin", "mcp-bing-ads");
      symlinkSync(resolve(ROOT, "dist/index.js"), link);
      expect(await listToolsVia(link)).toContain("bing_ads_list_campaigns");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
