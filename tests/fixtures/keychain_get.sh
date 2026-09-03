#!/bin/bash
# keychain_get.sh — TEST FIXTURE, not production code.
#
# CI runners here have never needed Python and don't have the real
# drak_ops package installed; provisioning that (a new deploy-key/secret
# per repo, the way mharnett/task-mgmt's CI does it) is out of scope for a
# test-only need. This fixture is a hermetic double of the real shared
# helper (mharnett/drak-ops, src/drak_ops/keychain_get.sh) so
# tests/run-mcp-keychain.test.sh can exercise run-mcp.sh's actual
# source -> call -> success/miss logic without real Keychain, real python,
# or real drak_ops anywhere. A fake `python3` on PATH (see
# tests/run-mcp-keychain.test.sh) resolves HELPER to this file instead of
# shelling out to the real interpreter.
#
# The contract block immediately below is copied VERBATIM from
# drak-ops's src/drak_ops/keychain_get.sh so this fixture cannot silently
# drift from the production contract it doubles. Keep it byte-for-byte in
# sync if that file's contract ever changes.
#
# ---- BEGIN verbatim contract (drak_ops/keychain_get.sh) ----
#
# CONTRACT
#   - Strict, always — no tolerant/strict split like the Python helper has.
#     A shell caller that wants to tolerate a miss (e.g. an optional
#     healthcheck ping URL) does that visibly at its own call site with
#     `|| true`, exactly like the historic inline calls already did. A
#     silently-empty credential inside a cron job is worse than a loud
#     failure, so the default here is the loud one.
#   - stdout: on success, exactly what `security ... -w` prints (including
#     its trailing newline — `$(...)` strips it the same as it always has).
#     On failure, nothing.
#   - exit code: `security`'s own exit code passes through unchanged (0 on
#     success, 44 on "item not found", nonzero on any other failure). This
#     function never remaps or swallows it.
#   - set -e: `secret=$(keychain_get "SVC")` under the caller's `set -e`
#     aborts the script on a miss. A failing command substitution used in an
#     assignment is a plain simple command, and `set -e` is NOT suspended for
#     it (unlike inside an `if`/`while`/`&&`/`||`/`!`) — so this is the
#     enforcement mechanism for "strict, always" above, not just documentation.
#   - This file defines a function; it must be SOURCED (`source keychain_get.sh`
#     or `. keychain_get.sh`), never executed (`./keychain_get.sh`) — running
#     it as a subprocess would define the function in a throwaway shell that
#     exits immediately, and the caller's `set -e` wouldn't apply to calls
#     made from a separate process anyway.
#   - Resolves `security` via PATH, not the hardcoded `/usr/bin/security`
#     most of the inline calls this replaces used. Deliberate: it's what lets
#     this helper's own test suite substitute a fake `security` on PATH and
#     run with no real Keychain entry present, in CI, on Linux. Production
#     callers run with the standard macOS PATH, where `/usr/bin/security` is
#     what resolves anyway.
#
# ---- END verbatim contract ----

keychain_get() {
  local service="$1"
  local account="${2:-}"
  if [ -n "$account" ]; then
    security find-generic-password -a "$account" -s "$service" -w
  else
    security find-generic-password -s "$service" -w
  fi
}
