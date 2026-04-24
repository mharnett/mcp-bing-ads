/**
 * Tool ↔ handler exhaustiveness test.
 *
 * The MCP server advertises tools via `tools` (src/tools.ts) and dispatches
 * calls via a `switch (name)` in `src/index.ts`. When the two drift — a tool
 * is declared but has no case, or a case exists for a removed tool — the
 * server silently misbehaves: the SDK surfaces advertised tools to the LLM,
 * the LLM calls one, the server either throws "Unknown tool" or executes
 * the wrong case.
 *
 * This test parses index.ts as text, extracts every `case "bing_ads_..."`
 * string, and asserts the case set equals the declared tool set.
 *
 * Pattern source: mcp-google-ads/src/tools.handler.test.ts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { tools } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_TS = join(__dirname, "index.ts");

function extractHandledToolNames(): string[] {
  const src = readFileSync(INDEX_TS, "utf8");
  const cases = new Set<string>();
  const re = /case\s+"(bing_ads_[a-z_]+)"\s*:/g;
  for (;;) {
    const match = re.exec(src);
    if (!match) break;
    cases.add(match[1]);
  }
  return [...cases].sort();
}

describe("tool ↔ handler exhaustiveness", () => {
  it("every declared tool has a dispatch case in index.ts", () => {
    const declared = tools.map((t) => t.name).sort();
    const handled = extractHandledToolNames();
    const missingHandler = declared.filter((name) => !handled.includes(name));
    expect(
      missingHandler,
      `Tools declared in tools.ts but not handled in index.ts: ${missingHandler.join(", ")}. ` +
        `Add a case in the CallToolRequestSchema switch or remove the tool declaration.`
    ).toEqual([]);
  });

  it("every dispatch case corresponds to a declared tool (no orphans)", () => {
    const declared = new Set(tools.map((t) => t.name));
    const handled = extractHandledToolNames();
    const orphaned = handled.filter((name) => !declared.has(name));
    expect(
      orphaned,
      `Dispatch cases in index.ts without a matching tool in tools.ts: ${orphaned.join(", ")}. ` +
        `Remove the dead case or add the missing tool declaration.`
    ).toEqual([]);
  });
});
