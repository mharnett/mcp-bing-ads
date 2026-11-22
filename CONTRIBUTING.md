# Contributing to mcp-bing-ads

Thanks for your interest in contributing. This project is maintained by one person alongside client work, so please keep the following in mind.

## Response times

- **Issues:** triaged within 7 days. Fixes ship when ready, with no promised cadence.
- **Pull requests:** reviewed within 1 to 2 weeks. Keep them small and focused.
- **Feature requests:** open an issue first to discuss. No guarantee of implementation.

## What gets accepted

**Yes:**
- Bug fixes with tests
- New read-only tools (reporting, listing)
- Documentation improvements
- Test coverage improvements
- New write tools: open an issue first. They ship behind the write switch below.

**Probably not:**
- Large architectural changes
- New dependencies without strong justification
- Features that significantly increase maintenance burden

## Development

You need Node.js 18.18 or later. CI runs Node 18, 20 and 22.

```bash
npm ci          # install dependencies
npm run build   # compile TypeScript to dist/
npm test        # run the test suite
npm run dev     # run the server from source
```

The tests need no Microsoft Advertising account or credentials, and CI runs them with none. A new test fakes the API call; it never talks to a real account.

## Before you open a pull request

1. `npm run build` compiles cleanly.
2. `npm test` passes.
3. A new tool is added to the tool table in `README.md`.
4. A tool that creates, changes, pauses, removes or uploads anything goes in `WRITE_TOOLS` in `src/writeGate.ts`. That keeps it hidden unless the user sets `BING_ADS_MCP_WRITE=true`.
5. The PR title is a [Conventional Commit](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`). PRs are squash-merged with the title as the commit message, and release-please builds the version and changelog from it. A check on every PR enforces this.
6. Nothing real is committed: no tokens, no `config.json`, and no real account ids, names or spend in tests or fixtures. Use made-up values.

## API versions

This server calls the Microsoft Advertising Campaign Management and Reporting APIs, version 13 (the base URLs are in `src/index.ts`). If you notice an upcoming deprecation or sunset, please open an issue.

## Security

If you find a security problem, such as a way to leak a token or to run a write tool without the write switch, please don't post the details in a public issue. Open an issue asking for a private contact instead.

## Code of conduct

Be respectful. This is a small project maintained in spare time. Constructive feedback is welcome; demands are not.
