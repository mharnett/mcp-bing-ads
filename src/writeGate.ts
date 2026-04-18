import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tools that mutate Bing Ads state. These are hidden from the tool list
 * and refused at call time unless BING_ADS_MCP_WRITE=true.
 *
 * Adding a new tool? Put it in this set if it creates, modifies, pauses,
 * enables, removes, links, unlinks, or applies anything.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "bing_ads_add_shared_negatives",
  "bing_ads_pause_keywords",
  "bing_ads_update_campaign_budget",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.BING_ADS_MCP_WRITE || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function filterTools(
  allTools: readonly Tool[],
  env: NodeJS.ProcessEnv = process.env,
): Tool[] {
  if (isWriteEnabled(env)) return [...allTools];
  return allTools.filter((t) => !WRITE_TOOLS.has(t.name));
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
  if (!isWriteTool(toolName)) return;
  if (isWriteEnabled(env)) return;
  throw new Error(
    `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
  );
}
