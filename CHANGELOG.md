# Changelog

## [1.1.1](https://github.com/mharnett/mcp-bing-ads/compare/mcp-bing-ads-v1.1.0...mcp-bing-ads-v1.1.1) (2026-07-09)


### Bug Fixes

* budget validation, GAQL mutation blocking, future date checks, limit caps ([da8d128](https://github.com/mharnett/mcp-bing-ads/commit/da8d1286bde7ea80ea21a8ba6f10178e422f3e48))
* **critical:** require account_id on write operations ([59a072e](https://github.com/mharnett/mcp-bing-ads/commit/59a072e509288efc19215c617206538a30403696))
* **critical:** use TimeoutStrategy.Aggressive to actually abort hung requests ([db52390](https://github.com/mharnett/mcp-bing-ads/commit/db52390bdf92156c3f1a93ad672be6eb3da81afe))
* drop unused file:../mcp-updatenotifier dependency ([#3](https://github.com/mharnett/mcp-bing-ads/issues/3)) ([fc4a84c](https://github.com/mharnett/mcp-bing-ads/commit/fc4a84ce0957a0ea8d9506c50dcc32698d867d82))
* error server prefix, isError consistency, validateCredentials, CHANGELOG ([6c07766](https://github.com/mharnett/mcp-bing-ads/commit/6c0776678d71b7e7859924f2bafe6df7dc274935))
* error size limits, safeResponse mutation, budget docs, CHANGELOG, security warnings ([48f1a23](https://github.com/mharnett/mcp-bing-ads/commit/48f1a2370636fb7e09d4141d49c18ab3486f990c))
* ID validation, path resolution, health tools, descriptions ([15c7392](https://github.com/mharnett/mcp-bing-ads/commit/15c7392c0af75553fa46af4e52c1cc91d0d59649))
* Node 18.18 minimum, env var trimming, unhandledRejection, TTY guard ([9c3433f](https://github.com/mharnett/mcp-bing-ads/commit/9c3433f80291b474f95594291164b36761f9d898))
* README accuracy, env var docs, dependency cleanup ([440f2ff](https://github.com/mharnett/mcp-bing-ads/commit/440f2ff56574bf6715232159d363242d46526841))
* resolve import and export issues from cascade failure ([39d4003](https://github.com/mharnett/mcp-bing-ads/commit/39d40032e289760ee7b8dd8a59d80b02cd051a4c))
* startup checks, credential redaction, schema hardening, format validation ([eed8c3b](https://github.com/mharnett/mcp-bing-ads/commit/eed8c3b12c8daec41b679a0b8d0a22120c6b38fb))
* stderr logging, Linux/Docker compat, SIGPIPE, version fallback ([60add35](https://github.com/mharnett/mcp-bing-ads/commit/60add35bb24d11f8199646a8ea6f65426a7d034c))
* version field, safeResponse loop, auth retry, SIGTERM handling ([26e5811](https://github.com/mharnett/mcp-bing-ads/commit/26e5811f8007dca30b2db2de73a35e1642f4f935))

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
