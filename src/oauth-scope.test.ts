import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// No-rotation model (2026-06): Bing's single refresh-token chain is shared by
// three consumers (this MCP, the weekly-runner, spc-daily). If any of them
// requests offline_access, Microsoft rotates the refresh token and invalidates
// the others' copies (a fork). The MCP must therefore NOT request offline_access.
// The shared token is re-bootstrapped ~quarterly via get-refresh-token.cjs.
const here = dirname(fileURLToPath(import.meta.url));

describe("oauth scope (no-rotation model)", () => {
  // config.json is gitignored (local/secret-bearing); the committed template is
  // config.example.json. Assert the template (always present) omits offline_access,
  // and the local config.json too when it exists.
  it("config.example.json scope must NOT request offline_access", () => {
    const cfg = JSON.parse(readFileSync(join(here, "..", "config.example.json"), "utf8"));
    expect(cfg.oauth.scope).not.toContain("offline_access");
  });

  it("local config.json (if present) scope must NOT request offline_access", () => {
    const p = join(here, "..", "config.json");
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      expect(cfg.oauth.scope).not.toContain("offline_access");
    } catch (e: any) {
      if (e.code === "ENOENT") return; // no local config in this env; example covers it
      throw e;
    }
  });
});
