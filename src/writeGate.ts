import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createWriteGate } from "mcp-write-gate";

/**
 * Tools that mutate Bing Ads state. These are hidden from the tool list
 * and refused at call time unless BING_ADS_MCP_WRITE=true.
 *
 * Adding a new tool? Put it in this set if it creates, modifies, pauses,
 * enables, removes, links, unlinks, or applies anything.
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "bing_ads_add_shared_negatives",
  "bing_ads_pause_keywords",
  "bing_ads_update_campaign_budget",
]);

const gate = createWriteGate({
  writeTools: WRITE_TOOLS,
  envPrefix: "BING_ADS",
});

export function isWriteTool(name: string): boolean {
  return gate.isWriteTool(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return gate.isWriteEnabled(env);
}

export function filterTools(
  allTools: readonly Tool[],
  env: NodeJS.ProcessEnv = process.env,
): Tool[] {
  return gate.filterTools(allTools, env);
}

export const WRITE_DISABLED_MESSAGE =
  "Write operations are disabled. Set BING_ADS_MCP_WRITE=true in the MCP server environment to enable mutating tools (create/update/pause/enable/remove/apply).";

/**
 * Assert that a tool call is allowed under the current write-mode setting.
 * Throws a clear Error if the tool mutates state and writes are disabled.
 */
export function assertWriteAllowed(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    gate.assertWriteAllowed(toolName, env);
  } catch (e) {
    throw new Error(
      `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
    );
  }
}
