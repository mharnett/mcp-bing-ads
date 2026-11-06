// ============================================
// CI guard: the Windows leg of test.yml stay off ordinary pushes/PRs.
// ============================================
// Windows minutes bill at ~2x Linux (macOS ~10x). Running the Windows leg of
// the matrix on every push and PR was a measurable share of the account's
// Actions bill in Oct-Nov 2026.
//
// The portability coverage is kept, not dropped: the full matrix still runs
//   * weekly (schedule) and on demand (workflow_dispatch), and
//   * on release-please PRs (head ref `release-please--…`), so a build that
//     is about to be published to npm is always tested on every OS first.
//
// Superseded PR runs are cancelled; pushes to main never are, so every merge
// keeps its own complete run.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wf = readFileSync(
  path.join(__dirname, ".github/workflows/test.yml"),
  "utf-8",
);

const osLine = wf.split("\n").find((l) => /^\s*os:/.test(l)) ?? "";

describe("test.yml OS matrix", () => {
  it("is not a static list that always includes macOS", () => {
    expect(osLine).not.toMatch(/^\s*os:\s*\[/);
    expect(osLine).toContain("fromJSON(");
  });

  it("defaults to ubuntu-only", () => {
    expect(osLine).toMatch(/\|\|\s*'\["ubuntu-latest"\]'/);
  });

  it("expands to the full OS list for schedule, dispatch and release PRs", () => {
    expect(osLine).toContain(
      `'["ubuntu-latest","windows-latest"]'`,
    );
    expect(osLine).toContain("github.event_name == 'schedule'");
    expect(osLine).toContain("github.event_name == 'workflow_dispatch'");
    expect(osLine).toContain("startsWith(github.head_ref, 'release-please--')");
  });

  it("has a weekly schedule and a manual trigger to carry the full matrix", () => {
    expect(wf).toMatch(/^\s*schedule:\s*\n\s*-\s*cron:/m);
    expect(wf).toMatch(/^\s*workflow_dispatch:/m);
  });
});

describe("test.yml concurrency", () => {
  it("cancels superseded runs only for pull_request events", () => {
    expect(wf).toMatch(/^concurrency:/m);
    expect(wf).toContain("group: ${{ github.workflow }}-${{ github.ref }}");
    expect(wf).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });
});
