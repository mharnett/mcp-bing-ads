// Tests for npm-audit-gate.mjs. Same file in every mharnett MCP repo: change
// it in one, copy it to the rest.
//
// Nothing here touches the network. The reports are the shapes real npm 11
// printed on 2026-11-24 (against the registry, and against a local stub that
// answered 503, HTML, nothing and `{}`), trimmed to the fields the gate reads.

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANARY, checkCanary, checkIgnores, evaluate, runGate } from "./npm-audit-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "npm-audit-gate.mjs");
const SHIPPED = JSON.parse(readFileSync(path.join(HERE, "npm-audit-ignores.json"), "utf-8"));

const advisory = (id, name, severity, title = `${name} advisory`) => ({
  source: 1, name, dependency: name, title, severity, range: "<9.9.9",
  url: `https://github.com/advisories/${id}`,
});
const pkg = (name, severity, ...via) => ({ name, severity, isDirect: true, via, effects: [], range: "<9.9.9" });

const SDK = "@modelcontextprotocol/sdk";
const REBIND = advisory("GHSA-w48q-cv73-mx4w", SDK, "high", "DNS rebinding");
const REDIRECT = advisory("GHSA-6prh-2h8m-c8cw", SDK, "moderate", "Cross-origin redirects");
const ZOD = advisory("GHSA-mrhx-c7xc-m3w5", "zod", "high", "Memory exhaustion");
const FRESH = advisory("GHSA-2222-3333-4444", "axios", "high", "Brand new");

/** A well-formed `npm audit --json` report over `packages`. */
function report(packages, { total = 151 } = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: packages.length };
  for (const p of packages) if (p.severity in counts) counts[p.severity]++;
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(packages.map((p) => [p.name, p])),
    metadata: { vulnerabilities: counts, dependencies: { prod: total, dev: 0, optional: 0, peer: 0, peerOptional: 0, total } },
  };
}

const KNOWN = [pkg(SDK, "high", REBIND, REDIRECT, "zod"), pkg("zod", "high", ZOD)];
const today = "2026-11-30";
const ignore = (id, name, severity, over = {}) => ({
  id, package: name, severity, reason: "not reachable on a stdio-only server", expires: "2027-01-27", ...over,
});
const IGNORES = [
  ignore("GHSA-w48q-cv73-mx4w", SDK, "high"),
  ignore("GHSA-6prh-2h8m-c8cw", SDK, "moderate"),
  ignore("GHSA-mrhx-c7xc-m3w5", "zod", "high"),
];

/** evaluate() on a report; npm's exit code is the one npm would give it. */
function judge(rep, { ignores = IGNORES, status, stdout } = {}) {
  const c = rep?.metadata?.vulnerabilities ?? {};
  return evaluate({
    stdout: stdout ?? JSON.stringify(rep, null, 2),
    status: status === undefined ? Number((c.high ?? 0) + (c.critical ?? 0) > 0) : status,
    ignores,
  });
}

describe("today's report: the three ignored advisories and nothing else", () => {
  it("passes, and says which advisories were ignored and until when", () => {
    const r = judge(report(KNOWN));
    expect(r.problems).toEqual([]);
    expect(r.notes.filter((n) => n.startsWith("ignored through 2027-01-27"))).toHaveLength(3);
  });

  it("fails when the same report has no ignore list", () => {
    const r = judge(report(KNOWN), { ignores: [] });
    expect(r.problems.filter((p) => /not ignored/.test(p))).toHaveLength(2); // the moderate one does not gate
  });

  it("counts a package that is only high because it depends on an ignored one", () => {
    expect(judge(report([...KNOWN, pkg("some-harness", "high", SDK)])).problems).toEqual([]);
  });
});

describe("a new high or critical fails", () => {
  it.each(["high", "critical"])("%s in a package nobody ignored", (severity) => {
    const r = judge(report([...KNOWN, pkg("axios", severity, { ...FRESH, severity })]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("GHSA-2222-3333-4444");
    expect(r.problems[0]).toContain("axios");
    expect(r.problems[0]).toContain(severity);
  });

  it("in a package that already has an ignored advisory", () => {
    const second = advisory("GHSA-2222-3333-4444", SDK, "high");
    const r = judge(report([pkg(SDK, "high", REBIND, REDIRECT, second, "zod"), KNOWN[1]]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("GHSA-2222-3333-4444");
  });

  it("that carries an ignored id on a different package", () => {
    const elsewhere = advisory("GHSA-w48q-cv73-mx4w", "sdk-fork", "high");
    expect(judge(report([...KNOWN, pkg("sdk-fork", "high", elsewhere)])).problems).toHaveLength(1);
  });

  it("that is an ignored advisory re-scored above the severity it was ignored at", () => {
    const rescored = { ...REDIRECT, severity: "high" };
    const r = judge(report([pkg(SDK, "high", REBIND, rescored, "zod"), KNOWN[1]]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("GHSA-6prh-2h8m-c8cw");
  });

  it.each(["high", "severe"])("whose advisory severity is a word this gate does not know (package: %s)", (severity) => {
    expect(judge(report([...KNOWN, pkg("axios", severity, { ...FRESH, severity: "severe" })])).problems.length).toBeGreaterThan(0);
  });

  it("whose advisory has no GHSA id to check against the list", () => {
    const r = judge(report([...KNOWN, pkg("axios", "high", { ...FRESH, url: "https://example.com/x" })]));
    expect(r.problems).toHaveLength(1);
  });

  it("whose package names no advisory at all", () => {
    const r = judge(report([...KNOWN, pkg("axios", "high", "follow-redirects")]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("axios");
  });

  it("reached through a dependency cycle, and the walk ends", () => {
    const r = judge(report([...KNOWN, pkg("a", "high", "b"), pkg("b", "high", "a")]));
    expect(r.problems).toHaveLength(2);
  });

  it("but a new moderate does not", () => {
    const r = judge(report([...KNOWN, pkg("uuid", "moderate", { ...FRESH, name: "uuid", severity: "moderate" })]));
    expect(r.problems).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/1 moderate/);
  });

  it("prints a registry-supplied title on one line", () => {
    const r = judge(report([...KNOWN, pkg("axios", "high", { ...FRESH, title: "x\n::error::spoof\r\u001b[31m" })]));
    // eslint-disable-next-line no-control-regex
    expect(r.problems[0]).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("a failed audit fails", () => {
  it.each([
    ["503", { message: "503 Service Unavailable - POST https://r/ - down", statusCode: 503, body: { error: "down" }, error: { summary: "", detail: "" } }, "503 Service Unavailable"],
    ["html", { message: "invalid json response body at https://r/", error: { summary: "", detail: "" } }, "invalid json response"],
    ["refused", { message: "request to https://r/ failed, reason: connect ECONNREFUSED", error: { summary: "", detail: "" } }, "ECONNREFUSED"],
    ["no lockfile", { error: { code: "ENOLOCK", summary: "This command requires an existing lockfile.", detail: "" } }, "requires an existing lockfile"],
  ])("%s, and repeats npm's reason", (_name, body, reason) => {
    const r = judge(body, { status: 1 });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain(reason);
  });

  it.each([
    ["no output", "", 1],
    ["no output and exit 0", "", 0],
    ["cut off", JSON.stringify(report(KNOWN)).slice(0, 200), 1],
    ["null", "null", 0],
    ["a list", "[]", 0],
    ["an empty object", "{}", 0],
    ["an older report version", JSON.stringify({ ...report(KNOWN), auditReportVersion: 1 }), 1],
    ["no vulnerabilities map", JSON.stringify({ ...report(KNOWN), vulnerabilities: undefined }), 1],
    ["no metadata", JSON.stringify({ ...report(KNOWN), metadata: undefined }), 1],
    ["a null package entry", JSON.stringify({ ...report(KNOWN), vulnerabilities: { zod: null } }), 1],
  ])("%s", (_name, stdout, status) => {
    expect(judge(null, { stdout, status }).problems).toHaveLength(1);
  });

  it.each([[0], [2], [null]])("npm exit %s on a report with highs", (status) => {
    expect(judge(report(KNOWN), { status }).problems).toHaveLength(1);
  });

  it("npm exit 1 on a report with no highs", () => {
    expect(judge(report([]), { status: 1, ignores: [] }).problems).toHaveLength(1);
  });

  it("totals that disagree with the packages listed", () => {
    const cut = report(KNOWN);
    delete cut.vulnerabilities.zod;
    cut.vulnerabilities[SDK].via = [REBIND, REDIRECT];
    expect(judge(cut, { ignores: IGNORES.slice(0, 2) }).problems).toHaveLength(1);
  });
});

describe("an empty audit fails", () => {
  it("when the registry answered `{}`: exit 0, no findings, 151 packages", () => {
    const r = judge(report([]));
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toMatch(/GHSA-w48q-cv73-mx4w.*not in the audit/);
  });

  it("when no packages were audited", () => {
    const r = judge(report([], { total: 0 }), { ignores: [] });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/0 packages/);
  });

  it("but a clean report with nothing ignored passes", () => {
    expect(judge(report([]), { ignores: [] }).problems).toEqual([]);
  });

  it("the canary must name its known advisory", () => {
    const seen = report([pkg(CANARY.name, "critical", advisory(CANARY.advisory, CANARY.name, "critical"))]);
    expect(checkCanary({ stdout: JSON.stringify(seen), status: 1 })).toEqual([]);
    expect(checkCanary({ stdout: JSON.stringify(report([])), status: 0 })).toHaveLength(1);
    expect(checkCanary({ stdout: "", status: 1 })).toHaveLength(1);
    const other = report([pkg(CANARY.name, "critical", { ...FRESH, name: CANARY.name, severity: "critical" })]);
    expect(checkCanary({ stdout: JSON.stringify(other), status: 1 })).toHaveLength(1);
  });
});

describe("the ignore list", () => {
  it("accepts a complete list", () => {
    expect(checkIgnores(IGNORES, today)).toEqual([]);
    expect(checkIgnores([], today)).toEqual([]);
  });

  it("holds through the expiry date and fails the day after", () => {
    const [one] = IGNORES;
    expect(checkIgnores([one], "2027-01-27")).toEqual([]);
    const late = checkIgnores([one], "2027-01-28");
    expect(late).toHaveLength(1);
    expect(late[0]).toMatch(/GHSA-w48q-cv73-mx4w.*expired 2027-01-27/);
  });

  it.each([
    ["not a list", { id: "x" }],
    ["a null entry", [null]],
    ["no id", [ignore(undefined, "zod", "high")]],
    ["a CVE id", [ignore("CVE-2026-1", "zod", "high")]],
    ["a wildcard id", [ignore("GHSA-*", "zod", "high")]],
    ["no package", [ignore("GHSA-mrhx-c7xc-m3w5", "", "high")]],
    ["no severity", [ignore("GHSA-mrhx-c7xc-m3w5", "zod", undefined)]],
    ["no reason", [ignore("GHSA-mrhx-c7xc-m3w5", "zod", "high", { reason: "  " })]],
    ["no expiry", [ignore("GHSA-mrhx-c7xc-m3w5", "zod", "high", { expires: undefined })]],
    ["a date that does not exist", [ignore("GHSA-mrhx-c7xc-m3w5", "zod", "high", { expires: "2027-02-30" })]],
    ["a date in another format", [ignore("GHSA-mrhx-c7xc-m3w5", "zod", "high", { expires: "27 Jan 2027" })]],
    ["the same advisory twice", [IGNORES[0], IGNORES[0]]],
  ])("rejects %s", (_name, list) => {
    expect(checkIgnores(list, today).length).toBeGreaterThan(0);
  });

  it("as shipped, is valid until its first expiry and expires in full after its last", () => {
    // Never checked against the real clock here: that is the weekly job's
    // work, and an expiry must not turn every pull request red.
    expect(Array.isArray(SHIPPED)).toBe(true);
    const dates = SHIPPED.map((i) => i.expires).sort();
    expect(checkIgnores(SHIPPED, dates[0] ?? today)).toEqual([]);
    expect(checkIgnores(SHIPPED, "9999-12-31")).toHaveLength(SHIPPED.length);
  });
});

describe("runGate", () => {
  const canary = JSON.stringify(report([pkg(CANARY.name, "critical", advisory(CANARY.advisory, CANARY.name, "critical"))]));
  const answers = (mine, over = {}) => {
    const calls = [];
    const audit = (cwd) => {
      const isCanary = cwd !== "/repo";
      calls.push({ cwd, lock: isCanary ? JSON.parse(readFileSync(path.join(cwd, "package-lock.json"), "utf-8")) : null });
      if (isCanary) return over.canary ?? { stdout: canary, status: 1 };
      return { stdout: JSON.stringify(mine), status: 1 };
    };
    return { calls, audit };
  };

  it("audits the repo and a throwaway lockfile with a known-vulnerable package", () => {
    const { calls, audit } = answers(report(KNOWN));
    const r = runGate({ cwd: "/repo", ignores: IGNORES, today, audit });
    expect(r.problems).toEqual([]);
    expect(calls.map((c) => c.cwd === "/repo")).toEqual([true, false]);
    expect(calls[1].lock.packages[`node_modules/${CANARY.name}`].version).toBe(CANARY.version);
    expect(existsSync(calls[1].cwd)).toBe(false); // cleaned up
  });

  it("fails on a blind canary even when the repo's own report looks fine", () => {
    const { audit } = answers(report(KNOWN), { canary: { stdout: JSON.stringify(report([])), status: 0 } });
    expect(runGate({ cwd: "/repo", ignores: IGNORES, today, audit }).problems).toHaveLength(1);
  });

  it("fails when npm cannot be started", () => {
    const audit = () => ({ stdout: "", status: null, error: new Error("spawn npm ENOENT") });
    const r = runGate({ cwd: "/repo", ignores: IGNORES, today, audit });
    expect(r.problems.join("\n")).toContain("ENOENT");
  });

  it("reports an expired ignore and a new high together", () => {
    const { audit } = answers(report([...KNOWN, pkg("axios", "high", FRESH)]));
    const r = runGate({ cwd: "/repo", ignores: IGNORES, today: "2027-02-01", audit });
    expect(r.problems.filter((p) => /expired/.test(p))).toHaveLength(3);
    expect(r.problems.filter((p) => /GHSA-2222-3333-4444/.test(p))).toHaveLength(1);
  });
});

// The command the workflow runs, with a fake `npm` first on PATH. POSIX only:
// the job runs on Linux, and Windows resolves `npm` differently.
describe.skipIf(process.platform === "win32")("the command line", () => {
  const dirs = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  const canaryJson = JSON.stringify(report([pkg(CANARY.name, "critical", advisory(CANARY.advisory, CANARY.name, "critical"))]));
  const longLived = IGNORES.map((i) => ({ ...i, expires: "9999-12-31" }));

  function run(mine, { exit = 1, ignores = longLived, canaryExit = 1, canaryOut = canaryJson, args, gate = GATE, noNpm } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "npm-audit-gate-test-"));
    dirs.push(dir);
    const bin = path.join(dir, "bin");
    const repo = path.join(dir, "repo");
    mkdirSync(bin);
    mkdirSync(repo);
    writeFileSync(path.join(repo, "package.json"), '{"name":"some-server"}');
    writeFileSync(path.join(dir, "mine.json"), typeof mine === "string" ? mine : JSON.stringify(mine));
    writeFileSync(path.join(dir, "canary.json"), canaryOut);
    writeFileSync(path.join(dir, "ignores.json"), typeof ignores === "string" ? ignores : JSON.stringify(ignores));
    if (!noNpm) {
      const npm = path.join(bin, "npm");
      writeFileSync(npm, `#!/bin/sh
echo "$@" >> "${dir}/argv"
if grep -q some-server package.json; then cat "${dir}/mine.json"; exit ${exit}; fi
cat "${dir}/canary.json"; exit ${canaryExit}
`);
      chmodSync(npm, 0o755);
    }
    const r = spawnSync(process.execPath, [gate, ...(args ?? ["--ignores", path.join(dir, "ignores.json")])], {
      cwd: repo, encoding: "utf-8", env: { PATH: noNpm ? bin : `${bin}:/usr/bin:/bin`, TMPDIR: tmpdir() },
    });
    const argv = path.join(dir, "argv");
    return { code: r.status, out: r.stdout + r.stderr, argv: existsSync(argv) ? readFileSync(argv, "utf-8") : "" };
  }

  it("exits 0 and says so when only ignored advisories remain", () => {
    const r = run(report(KNOWN));
    expect(r.out).toContain("PASS");
    expect(r.code).toBe(0);
  });

  it("audits the lockfile only, twice, at level high", () => {
    const calls = run(report(KNOWN)).argv.trim().split("\n");
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.split(" ")).toEqual(expect.arrayContaining(["audit", "--json", "--package-lock-only", "--audit-level=high"]));
  });

  it.each([
    ["a new high", [report([...KNOWN, pkg("axios", "high", FRESH)])]],
    ["an expired ignore", [report(KNOWN), { ignores: IGNORES.map((i) => ({ ...i, expires: "2020-01-01" })) }]],
    ["an unreadable ignore list, with nothing to ignore", [report([]), { exit: 0, ignores: "{not json" }]],
    ["a missing ignore list, with nothing to ignore", [report([]), { exit: 0, args: ["--ignores", "/nonexistent/ignores.json"] }]],
    ["an unknown option", [report(KNOWN), { args: ["--skip"] }]],
    ["a failed audit", ['{"message":"503 Service Unavailable","error":{}}']],
    ["an empty answer", [report([]), { exit: 0 }]],
    ["no output at all", ["", { exit: 0 }]],
    ["a blind canary", [report(KNOWN), { canaryOut: JSON.stringify(report([])), canaryExit: 0 }]],
    ["no npm on PATH", [report(KNOWN), { noNpm: true }]],
  ])("exits 1 on %s", (_name, args) => {
    const r = run(...args);
    expect(r.out).toContain("FAIL");
    expect(r.out).not.toContain("PASS");
    expect(r.code).toBe(1);
  });

  it("still runs when started through a symlink", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "npm-audit-gate-link-"));
    dirs.push(dir);
    const link = path.join(dir, "gate.mjs");
    symlinkSync(GATE, link);
    expect(run(report([...KNOWN, pkg("axios", "high", FRESH)]), { gate: link }).code).toBe(1);
  });
});
