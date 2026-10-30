// ============================================
// CI guard: a release-please release publishes to npm without a manual
// dispatch, and PR titles are linted so release-please sees every change.
// ============================================
// release-please creates its Release with GITHUB_TOKEN, and events from that
// token do not trigger other workflows — except workflow_dispatch. So
// release-please.yml dispatches publish.yml itself. Publishing stays in
// publish.yml because npm's Trusted Publisher is registered to that filename;
// a publish job inside release-please.yml would fail OIDC. (2026-10-30)
//
// Squash merges take the PR title as the commit subject, which is what
// release-please parses; untitled changes never reach a release.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const wf = (name) => path.join(REPO, ".github/workflows", name);
// YAML with comment lines dropped, so prose about a trigger is not the trigger.
const code = (p) => readFileSync(p, "utf-8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("release-please.yml dispatches publish.yml on a new release", () => {
  const yml = code(wf("release-please.yml"));

  it("gives the release-please step an id so its outputs are readable", () => {
    expect(yml).toMatch(/id:\s*release\b/);
  });

  it("dispatches publish.yml with the release tag, only when a release was created", () => {
    expect(yml).toMatch(/gh workflow run publish\.yml[^\n]*-f ref=\$\{\{\s*steps\.release\.outputs\.tag_name\s*\}\}/);
    expect(yml).toMatch(/if:\s*\$\{\{\s*steps\.release\.outputs\.release_created\s*\}\}/);
  });

  it("grants actions: write so GITHUB_TOKEN may dispatch", () => {
    expect(yml).toMatch(/actions:\s*write/);
  });

  it("does not publish to npm itself (Trusted Publisher is bound to publish.yml)", () => {
    expect(yml).not.toMatch(/npm publish/);
  });
});

describe("publish.yml keeps its manual dispatch entry point", () => {
  it("accepts workflow_dispatch with a ref input", () => {
    const yml = readFileSync(wf("publish.yml"), "utf-8");
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(/ref:/);
  });
});

describe("pr-title.yml lints PR titles as conventional commits", () => {
  const p = wf("pr-title.yml");

  it("exists", () => {
    expect(existsSync(p)).toBe(true);
  });

  it("uses the unprivileged pull_request trigger, not pull_request_target", () => {
    const yml = code(p);
    expect(yml).toMatch(/\bpull_request:/);
    expect(yml).not.toMatch(/pull_request_target/);
  });

  it("pins action-semantic-pull-request to a full commit SHA", () => {
    const yml = readFileSync(p, "utf-8");
    expect(yml).toMatch(/amannn\/action-semantic-pull-request@[0-9a-f]{40}\b/);
  });
});
