# Changelog

## [1.1.0] - 2026-04-18

### Added
- **Read-only by default**: mutating tools (`bing_ads_pause_keywords`, `bing_ads_update_campaign_budget`, `bing_ads_add_shared_negatives`) are now hidden from the tool list and refused at call time unless `BING_ADS_MCP_WRITE=true` is set in the server environment.
- New `writeGate.ts` module with `isWriteTool`, `isWriteEnabled`, `filterTools`, `assertWriteAllowed`, and `WRITE_TOOLS` set.
- Startup log line reports current write-mode status.
- Drift-alarm test asserts every registered tool in `tools.ts` is classified as either a write or a read tool, so adding a new tool without classifying it fails CI.

### Security
- Foot-gun mitigation: prevents casual write actions (pausing keywords, editing budgets) from a passing chat request. Writes are now opt-in per server instance.

## [1.0.12] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

### Fixed
- Budget unit documentation clarified in tool descriptions

## [1.0.8] - 2026-04-09

### Added
- Published to npm
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- Shell injection fix in token rotation
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
