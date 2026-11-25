#!/usr/bin/env node
// Fails when `npm audit` reports a high or critical advisory that
// npm-audit-ignores.json does not name. Run by a scheduled workflow; nothing
// runs it on pull requests, because a newly published advisory is not the
// pull request's doing.
//
//   node scripts/npm-audit-gate.mjs [--ignores <file>]
//
// Same file in every mharnett MCP repo: change it in one, copy it to the rest.
//
// It also fails when the audit did not happen, because npm does not make that
// obvious: a registry that answers `{}` gives exit 0 and no findings, the same
// output as a clean audit. Two controls tell them apart. Every run also audits
// a throwaway lockfile holding a package with a known advisory, which must be
// reported. And every ignored advisory must still be in the report; once its
// package is upgraded, delete the entry.
//
// An ignore names one advisory on one package at one severity, says why, and
// has a last valid day (UTC). The day after, the run fails until somebody
// fixes the package or writes a new reason and date.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const GATES = RANK.high;
// Reads the lockfile only: nothing is installed and no package code runs.
const NPM_ARGS = ["audit", "--json", "--package-lock-only", "--audit-level=high"];
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

/** A package whose advisory is old, critical and not going away. Never installed. */
export const CANARY = { name: "minimist", version: "0.0.8", advisory: "GHSA-xvch-5gv4-984h" };

const oneLine = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim().slice(0, 300);
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const rank = (severity) => (Object.hasOwn(RANK, severity) ? RANK[severity] : Infinity);
const ghsaOf = (advisory) => String(advisory.url ?? "").split("/").pop();

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Problems with the ignore list itself, as of `today` (YYYY-MM-DD, UTC). */
export function checkIgnores(ignores, today) {
  if (!Array.isArray(ignores)) return ["the ignore list is not a JSON list"];
  const problems = [];
  const seen = new Set();
  ignores.forEach((entry, i) => {
    const at = `ignore ${i + 1}`;
    if (!isObject(entry)) return problems.push(`${at} is not an object`);
    const { id, package: name, severity, reason, expires } = entry;
    const label = `${at} (${oneLine(id)})`;
    if (!GHSA.test(id ?? "")) problems.push(`${label}: "id" must be a GHSA id`);
    if (typeof name !== "string" || !name.trim()) problems.push(`${label}: "package" is missing`);
    if (!Object.hasOwn(RANK, severity ?? "")) problems.push(`${label}: "severity" must be one of ${Object.keys(RANK).join(", ")}`);
    if (typeof reason !== "string" || !reason.trim()) problems.push(`${label}: "reason" is missing`);
    if (!isRealDate(expires)) problems.push(`${label}: "expires" must be a date, YYYY-MM-DD`);
    else if (today > expires) {
      problems.push(`the ignore for ${id} (${name}) expired ${expires}: fix the package, or give the entry a new reason and date`);
    }
    const key = `${id} ${name}`;
    if (seen.has(key)) problems.push(`${label}: listed twice`);
    seen.add(key);
  });
  return problems;
}

/** The parsed report, or { problem } when npm did not produce a usable one. */
function readReport({ stdout, status, error }) {
  if (error) return { problem: `npm audit did not run: ${oneLine(error.message)}` };
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { problem: `npm audit printed no readable JSON (exit ${status}, ${String(stdout ?? "").length} characters)` };
  }
  if (!isObject(data)) return { problem: "npm audit printed JSON that is not a report" };
  if (data.error || data.message) {
    const reason = data.message || data.error?.summary || data.error?.code || "no reason given";
    return { problem: `npm audit failed: ${oneLine(reason)}` };
  }
  const { auditReportVersion, vulnerabilities, metadata } = data;
  const counts = metadata?.vulnerabilities;
  if (auditReportVersion !== 2 || !isObject(vulnerabilities) || !isObject(counts) || !Object.values(vulnerabilities).every(isObject)) {
    return { problem: "npm audit printed a report this gate cannot read" };
  }
  const total = metadata.dependencies?.total;
  if (!(total > 0)) return { problem: `npm audit checked ${oneLine(total ?? "no")} packages` };

  const listed = Object.values(vulnerabilities).filter((v) => rank(v.severity) >= GATES).length;
  const counted = (counts.high ?? 0) + (counts.critical ?? 0);
  if (listed !== counted) {
    return { problem: `npm audit counts ${counted} high or critical packages but lists ${listed}` };
  }
  // With --audit-level=high, npm exits 1 exactly when it found one.
  if (status !== (counted > 0 ? 1 : 0)) {
    return { problem: `npm audit exited ${status} with ${counted} high or critical packages reported` };
  }
  return { vulnerabilities, counts, total };
}

/** Every advisory reachable from a package, through the packages it names in `via`. */
function advisoriesFor(name, vulnerabilities, visited = new Set()) {
  if (visited.has(name)) return [];
  visited.add(name);
  const via = vulnerabilities[name]?.via;
  return (Array.isArray(via) ? via : []).flatMap((v) =>
    typeof v === "string" ? advisoriesFor(v, vulnerabilities, visited) : isObject(v) ? [v] : [],
  );
}

/** Judge one audit of the repo. `problems` fail the run; `notes` do not. */
export function evaluate({ stdout, status, error, ignores }) {
  const read = readReport({ stdout, status, error });
  if (read.problem) return { problems: [read.problem], notes: [] };
  const { vulnerabilities, counts, total } = read;

  const unexplained = [];
  const advisories = new Map();
  for (const name of Object.keys(vulnerabilities)) {
    const found = advisoriesFor(name, vulnerabilities);
    for (const a of found) advisories.set(`${ghsaOf(a)} ${a.name}`, a);
    if (rank(vulnerabilities[name].severity) >= GATES && !found.some((a) => rank(a.severity) >= GATES)) {
      unexplained.push(`${oneLine(name)} is ${oneLine(vulnerabilities[name].severity)} but the report names no advisory for it`);
    }
  }

  const list = Array.isArray(ignores) ? ignores.filter(isObject) : [];
  const matched = new Set();
  const gating = [];
  for (const a of advisories.values()) {
    const id = ghsaOf(a);
    const entry = list.find((i) => i.id === id && i.package === a.name);
    if (entry) matched.add(entry);
    if (rank(a.severity) < GATES) continue;
    if (entry && rank(a.severity) <= rank(entry.severity)) continue;
    const why = entry ? `ignored at ${oneLine(entry.severity)}, now ${oneLine(a.severity)}` : "not ignored";
    gating.push(`${oneLine(id)} (${oneLine(a.name)}, ${oneLine(a.severity)}) is ${why}: ${oneLine(a.title)}`);
  }

  const missing = list
    .filter((entry) => !matched.has(entry))
    .map((e) => `${oneLine(e.id)} (${oneLine(e.package)}) is ignored but not in the audit: either the package is fixed, so delete the entry, or the registry's answer was incomplete`);
  const bySeverity = ["critical", "high", "moderate", "low", "info"].map((s) => `${counts[s] ?? 0} ${s}`).join(", ");
  return {
    problems: [...missing, ...unexplained, ...gating],
    notes: [
      `${total} packages audited, of which vulnerable: ${bySeverity}. Only high and critical can fail this run.`,
      ...list.filter((e) => matched.has(e)).map((e) => `ignored through ${oneLine(e.expires)}: ${oneLine(e.id)} (${oneLine(e.package)})`),
    ],
  };
}

/** Problems with the canary audit: [] when its known advisory was reported. */
export function checkCanary(result) {
  const read = readReport(result);
  if (read.problem) return [`canary: ${read.problem}`];
  const seen = advisoriesFor(CANARY.name, read.vulnerabilities).some((a) => ghsaOf(a) === CANARY.advisory);
  return seen ? [] : [`canary: the audit did not report ${CANARY.advisory} for ${CANARY.name}@${CANARY.version}, so its silence about this repo means nothing`];
}

function npmAudit(cwd) {
  return spawnSync("npm", NPM_ARGS, {
    cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024, timeout: 4 * 60 * 1000,
  });
}

/** Audit the repo at `cwd` and the canary, and collect every problem. */
export function runGate({ cwd, ignores, today, audit = npmAudit }) {
  const mine = evaluate({ ...audit(cwd), ignores });
  const dir = mkdtempSync(path.join(tmpdir(), "npm-audit-canary-"));
  try {
    const root = { name: "npm-audit-canary", version: "1.0.0", dependencies: { [CANARY.name]: CANARY.version } };
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...root, private: true }));
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({
      ...root, dependencies: undefined, lockfileVersion: 3, requires: true,
      packages: { "": root, [`node_modules/${CANARY.name}`]: { version: CANARY.version } },
    }));
    return { problems: [...checkIgnores(ignores, today), ...mine.problems, ...checkCanary(audit(dir))], notes: mine.notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let file = path.join(here, "npm-audit-ignores.json");
  if (argv.length === 2 && argv[0] === "--ignores") file = argv[1];
  else if (argv.length) return { problems: ["usage: npm-audit-gate.mjs [--ignores <file>]"], notes: [] };

  let ignores;
  try {
    ignores = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    return { problems: [`cannot read the ignore list: ${oneLine(err.message)}`], notes: [] };
  }
  return runGate({ cwd: process.cwd(), ignores, today: new Date().toISOString().slice(0, 10) });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { problems, notes } = main(process.argv.slice(2));
  for (const n of notes) console.log(`  ${n}`);
  for (const p of problems) console.log(`FAIL  ${p}`);
  if (!problems.length) console.log("PASS  no high or critical advisory outside the ignore list");
  process.exitCode = problems.length ? 1 : 0;
}
