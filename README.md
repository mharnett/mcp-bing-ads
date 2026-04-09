# Bing Ads MCP Server

[![npm version](https://img.shields.io/npm/v/mcp-bing-ads)](https://www.npmjs.com/package/mcp-bing-ads)
[![npm downloads](https://img.shields.io/npm/dm/mcp-bing-ads)](https://www.npmjs.com/package/mcp-bing-ads)
[![GitHub stars](https://img.shields.io/github/stars/mharnett/mcp-bing-ads)](https://github.com/mharnett/mcp-bing-ads)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Production-grade MCP server for Microsoft Advertising (Bing Ads) API. Enables Claude to manage Bing/Microsoft Ads accounts with full campaign, ad group, keyword, and performance analysis capabilities.

**Features:**
- **10 tools** -- production-tested
- Campaign, ad group, and keyword management
- Keyword performance analysis with quality scores
- Search term reporting & bid automation
- Budget & bid strategy optimization
- Campaign-level budget updates
- Negative keyword management (shared + campaign-level)

**Note:** ⚠️ First open-source Bing Ads MCP with comprehensive tooling
- No serious alternatives exist in the ecosystem
- Battle-tested across multiple accounts

## Installation

```bash
npm install mcp-bing-ads
```

## Configuration

1. **Get OAuth credentials:**
   - Go to [Microsoft Azure Portal](https://portal.azure.com/)
   - Create an Azure AD app registration
   - Grant API permissions: `Microsoft Advertising API`
   - Scopes: `https://ads.microsoft.com/msads.manage offline_access`

2. **Create `config.json`:**
   ```bash
   cp config.example.json config.json
   ```

3. **Fill in your credentials:**
   ```json
   {
     "oauth": {
       "client_id": "YOUR_AZURE_CLIENT_ID",
       "client_secret": "YOUR_AZURE_CLIENT_SECRET"
     },
     "clients": {
       "default": {
         "customer_id": "YOUR_CUSTOMER_ID",
         "account_id": "YOUR_ACCOUNT_ID",
         "name": "My Account"
       }
     }
   }
   ```

4. **Set environment variables (recommended):**
   ```bash
   export BING_ADS_DEVELOPER_TOKEN="your_developer_token"
   export BING_ADS_CLIENT_ID="your_client_id"
   export BING_ADS_REFRESH_TOKEN="your_refresh_token"
   # Optional:
   export BING_ADS_CLIENT_SECRET="your_client_secret"
   ```

## Usage

### Start the server
```bash
npm start
```

### Use with Claude Code
Add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "bing-ads": {
      "type": "http",
      "url": "http://localhost:3002"
    }
  }
}
```

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

### Example API Calls
```typescript
// Get client context
bing_ads_get_client_context({ working_directory: "/path/to/project" })

// List campaigns
bing_ads_list_campaigns()

// Get campaign performance
bing_ads_get_campaign_performance({
  start_date: "2026-01-01",
  end_date: "2026-03-01"
})

// Get keyword performance
bing_ads_keyword_performance({
  start_date: "2026-02-01",
  end_date: "2026-03-01"
})

// Create negative keywords
bing_ads_add_shared_negatives({
  shared_list_id: "list_123",
  keywords: [
    { text: "cheap", match_type: "Phrase" },
    { text: "discount", match_type: "Exact" }
  ]
})
```

## API Reference

### Context
- `bing_ads_get_client_context(working_directory)` -- Detect account from working directory

### Campaigns
- `bing_ads_list_campaigns()` -- List all campaigns
- `bing_ads_get_campaign_performance(start_date, end_date)` -- Campaign metrics
- `bing_ads_update_campaign_budget(campaign_id, daily_budget)` -- Update daily spend

### Ad Groups
- `bing_ads_list_ad_groups(campaign_id)` -- List ad groups in campaign

### Keywords
- `bing_ads_keyword_performance(start_date, end_date, [campaign_ids])` -- Keyword metrics & QS
- `bing_ads_search_term_report(start_date, end_date)` -- Search terms that triggered ads
- `bing_ads_pause_keywords(ad_group_id, keyword_ids)` -- Pause keywords

### Negative Keywords
- `bing_ads_list_shared_entities([type])` -- List shared negative lists
- `bing_ads_add_shared_negatives(list_id, keywords)` -- Add to shared list

### Performance Reports
- Campaign performance (ROI, conversions, CTR, CPC)
- Keyword performance (QS, expected CTR, ad relevance, landing page experience)
- Search term insights (which queries are converting)

## Key Metrics & Definitions

**Quality Score (QS):** 1-10 rating of keyword quality
- 1-3: Poor
- 4-6: Average
- 7-10: Excellent

**Expected CTR:** 1-9 rating of expected click-through rate
**Ad Relevance:** 1-9 rating of relevance to search query
**Landing Page Experience:** 1-9 rating of landing page quality

## CLI Tools

```bash
npm run dev                 # Run in dev mode (tsx)
npm run build             # Compile TypeScript
npm test                  # Run contract tests
```

## Architecture

**Files:**
- `src/index.ts` — MCP server, OAuth flow, tool handlers
- `src/tools.ts` — Tool schema definitions
- `src/errors.ts` — Error handling & classification
- `config.json` — Credentials & client mapping

**Error Classification:**
- Authentication errors (token expired)
- Rate limit errors (retry with backoff)
- Service errors (API temporarily unavailable)
- Validation errors (bad input)

## Development

### Adding a New Tool
1. Define schema in `src/tools.ts`
2. Add handler in `src/index.ts` tool dispatch
3. Add contract test in `.contract.test.ts`
4. Test with `npm test`

### Testing
```bash
npm test -- --run        # Single run
npm test -- --watch      # Watch mode
```

## Troubleshooting

### `Config file not found`
```bash
cp config.example.json config.json
# Fill in your Azure credentials and Bing Ads IDs
```

### `Missing required credentials`
Check that:
- `BING_ADS_DEVELOPER_TOKEN`, `BING_ADS_CLIENT_ID`, and `BING_ADS_REFRESH_TOKEN` are set
- `BING_ADS_CLIENT_SECRET` is set (if using a confidential app)
- OAuth token is valid (expires, may need refresh)

### `Rate limit exceeded`
Bing Ads applies rate limits. The server handles common retries automatically. If you hit limits frequently:
- Batch operations when possible
- Reduce query frequency
- Wait before retrying

### `Quality Score is 0`
QS = 0 means keyword hasn't been shown enough times yet. Increase impressions or wait for more data.

## License

MIT

## Contributing

Contributions welcome! Please:
1. Add tests for new features
2. Update README
3. Follow existing code style
4. Tag releases

## Support

- **Issues:** GitHub issues for bugs/feature requests
- **Docs:** See `docs/` folder for detailed API reference
- **Community:** GitHub Discussions

---

## Built By

**[Mark Harnett](https://www.linkedin.com/in/markharnett/)** — Demand generation leader and paid media practitioner building AI-powered ad management tools. This is the first comprehensive open-source Bing Ads MCP server — born from managing real campaigns across multiple accounts and wanting Claude to do the heavy lifting.

Built with production workloads in mind: resilient API calls (circuit breakers, retry with backoff, response truncation), full Quality Score diagnostics, and negative keyword management at scale.

**Also by Mark:** [mcp-linkedin-ads](https://github.com/mharnett/mcp-linkedin-ads) -- LinkedIn Ads MCP server with 7 tools.

**Last Updated:** 2026-03-13
