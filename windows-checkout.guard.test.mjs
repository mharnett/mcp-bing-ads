/**
 * Windows checks files out with CRLF line endings (core.autocrlf=true). Vite 7
 * only strips a "#!" line that ends in a bare LF (/^#!.*\n/), so a test that
 * imports such a script failed to parse there: "SyntaxError: Invalid or
 * unexpected token". This repeats a Windows checkout on any OS.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const scripts = git("ls-files", "*.mjs")
  .split("\n")
  .filter((file) => file && readFileSync(path.join(ROOT, file), "utf8").startsWith("#!"));

const out = mkdtempSync(path.join(tmpdir(), "windows-checkout-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("a Windows checkout", () => {
  it("keeps a bare LF on the #! line of every .mjs script", () => {
    // A check over no files would pass for the wrong reason.
    expect(scripts).toContain("scripts/npm-audit-gate.mjs");
    git("-c", "core.autocrlf=true", "checkout-index", `--prefix=${out.replaceAll("\\", "/")}/`, "--", ...scripts);

    const withCrlf = scripts.filter((file) => /^#!.*\r\n/.test(readFileSync(path.join(out, file), "utf8")));
    expect(withCrlf).toEqual([]);
  });
});
