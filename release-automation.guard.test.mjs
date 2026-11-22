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
//
// Each release also bumps server.json, the MCP Registry listing's manifest.
// Until 2026-11-22 nothing did, so the listing sat at 1.0.2 while npm reached
// 1.3.4. release-please-config.json lists server.json under extra-files.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const wf = (name) => path.join(REPO, ".github/workflows", name);
// YAML with comment lines dropped, so prose about a trigger is not the trigger.
const code = (p) => readFileSync(p, "utf-8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const readJson = (name) => JSON.parse(readFileSync(path.join(REPO, name), "utf-8"));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

describe("each release bumps server.json (the MCP Registry listing)", () => {
  const pkg = readJson("package.json");
  const config = readJson("release-please-config.json");
  const manifest = readJson(".release-please-manifest.json");
  const server = readJson("server.json");
  // Top-level config is the default for every package; the "." entry wins.
  const root = { ...config, ...config.packages["."] };

  // Every string field named "version" in server.json, as a concrete
  // jsonpath: [["$.version", "1.2.3"], ["$.packages[0].version", "1.2.3"]].
  const versionFields = (node, at = "$") => {
    if (Array.isArray(node)) return node.flatMap((v, i) => versionFields(v, `${at}[${i}]`));
    if (node && typeof node === "object") {
      return Object.entries(node).flatMap(([k, v]) =>
        k === "version" && typeof v === "string" ? [[`${at}.${k}`, v]] : versionFields(v, `${at}.${k}`),
      );
    }
    return [];
  };
  // The JSONPath subset extra-files uses here: dotted keys and [*].
  const selects = (jsonpath, concrete) =>
    new RegExp(`^${escapeRe(jsonpath).replace(/\\\[\\\*\\\]/g, "\\[\\d+\\]")}$`).test(concrete);

  const fields = versionFields(server);
  const jsonpaths = (root["extra-files"] ?? [])
    .filter((f) => typeof f === "object" && f.type === "json" && f.path === "server.json")
    .map((f) => f.jsonpath);

  it("release-please.yml loads release-please-config.json (a release-type input skips it, and its extra-files)", () => {
    const yml = code(wf("release-please.yml"));
    expect(yml).toMatch(/config-file:\s*release-please-config\.json/);
    expect(yml).toMatch(/manifest-file:\s*\.release-please-manifest\.json/);
    expect(yml).not.toMatch(/release-type:/);
  });

  it("lists server.json as a json extra-file for $.version and every $.packages[*].version", () => {
    expect([...jsonpaths].sort()).toEqual(["$.packages[*].version", "$.version"]);
  });

  it("those jsonpaths reach every version field in server.json, and each reaches one", () => {
    expect(fields.length).toBeGreaterThanOrEqual(2);
    const missed = fields.filter(([at]) => !jsonpaths.some((jp) => selects(jp, at))).map(([at]) => at);
    expect(missed).toEqual([]);
    const dead = jsonpaths.filter((jp) => !fields.some(([at]) => selects(jp, at)));
    expect(dead).toEqual([]);
  });

  it("server.json's versions equal package.json's version", () => {
    const stale = fields.filter(([, v]) => v !== pkg.version).map(([at, v]) => `${at}=${v}`);
    expect(stale, `package.json is ${pkg.version}`).toEqual([]);
  });

  it("the manifest pins package.json's version", () => {
    expect(manifest["."]).toBe(pkg.version);
  });

  it("the tag format matches the last release's, so release-please finds it", () => {
    const component = root["include-component-in-tag"] === false ? "" : `${root.component ?? pkg.name}-`;
    const heading = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf-8").match(
      new RegExp(`^## \\[${escapeRe(pkg.version)}\\]\\([^)]*/compare/[^)]*\\.\\.\\.([^)]+)\\)`, "m"),
    );
    expect(heading, `CHANGELOG.md has no compare-link heading for ${pkg.version}`).not.toBeNull();
    expect(heading[1]).toBe(`${component}v${pkg.version}`);
  });
});
