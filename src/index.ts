#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import { tmpdir } from "os";

// Log build fingerprint at startup
try {
  const __buildInfoDir = dirname(new URL(import.meta.url).pathname);
  const buildInfo = JSON.parse(readFileSync(join(__buildInfoDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  // build-info.json not present (dev mode)
}

// ============================================
// CONFIGURATION
// ============================================

interface ClientConfig {
  customer_id: string;
  account_id: string;
  name: string;
  folder: string;
}

interface OAuthConfig {
  client_id: string;
  client_secret?: string;
  token_url: string;
  scope: string;
}

interface Config {
  oauth: OAuthConfig;
  clients: Record<string, ClientConfig>;
}

function loadConfig(): Config {
  const configPath = join(dirname(new URL(import.meta.url).pathname), "..", "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}. Create config.json with client entries.`);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function getClientFromWorkingDir(config: Config, cwd: string): ClientConfig | null {
  for (const [key, client] of Object.entries(config.clients)) {
    if (cwd.startsWith(client.folder) || cwd.includes(key)) {
      return client;
    }
  }
  return null;
}

// ============================================
// TYPED ERRORS (mirrors motion-mcp pattern)
// ============================================

class BingAdsAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BingAdsAuthError";
  }
}

class BingAdsRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`Rate limited, retry after ${retryAfterMs}ms`);
    this.name = "BingAdsRateLimitError";
    this.cause = cause;
  }
}

class BingAdsServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "BingAdsServiceError";
  }
}

// ============================================
// STARTUP CREDENTIAL VALIDATION
// ============================================

function validateCredentials(): { valid: boolean; missing: string[] } {
  const required = [
    "BING_ADS_DEVELOPER_TOKEN",
    "BING_ADS_CLIENT_ID",
    "BING_ADS_REFRESH_TOKEN",
  ];
  const missing = required.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );
  return { valid: missing.length === 0, missing };
}

function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const status = error?.status;

  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_grant") ||
    message.includes("OAuth token refresh failed") ||
    message.includes("AuthenticationTokenExpired") ||
    message.includes("InvalidCredentials")
  ) {
    return new BingAdsAuthError(
      `Auth failed: ${message}. Refresh token may be expired. Re-authenticate and update Keychain.`,
      error,
    );
  }

  if (status === 429 || message.includes("RateLimit") || message.includes("CallRateExceeded")) {
    const retryMs = 60_000;
    return new BingAdsRateLimitError(retryMs, error);
  }

  if (status >= 500 || message.includes("InternalError")) {
    return new BingAdsServiceError(`Bing Ads API server error: ${message}`, error);
  }

  return error;
}

// ============================================
// MICROSOFT ADVERTISING API CLIENT
// ============================================

const CAMPAIGN_MGMT_BASE = "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13";
const REPORTING_BASE = "https://reporting.api.bingads.microsoft.com/Reporting/v13";

class BingAdsManager {
  private config: Config;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private developerToken: string;
  private refreshToken: string;

  constructor(config: Config) {
    this.config = config;

    // Validate credentials at startup — fail fast
    const creds = validateCredentials();
    if (!creds.valid) {
      const msg = `[STARTUP ERROR] Missing required credentials: ${creds.missing.join(", ")}. MCP will not function. Check run-mcp.sh and Keychain entries.`;
      console.error(msg);
      throw new BingAdsAuthError(msg);
    }
    console.error("[startup] Credentials validated: all required env vars present");

    this.developerToken = process.env.BING_ADS_DEVELOPER_TOKEN!;
    this.refreshToken = process.env.BING_ADS_REFRESH_TOKEN!;

    // Allow env vars to override config for OAuth
    if (process.env.BING_ADS_CLIENT_ID) {
      this.config.oauth.client_id = process.env.BING_ADS_CLIENT_ID;
    }
    if (process.env.BING_ADS_CLIENT_SECRET) {
      this.config.oauth.client_secret = process.env.BING_ADS_CLIENT_SECRET;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.oauth.client_id,
      refresh_token: this.refreshToken,
      scope: this.config.oauth.scope,
    });
    // Only include client_secret for confidential clients; public clients must omit it
    if (this.config.oauth.client_secret) {
      params.set("client_secret", this.config.oauth.client_secret);
    }

    const resp = await fetch(this.config.oauth.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const error = new Error(`OAuth token refresh failed: ${resp.status} ${text}`);
      throw classifyError(error);
    }

    const data = await resp.json() as any;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    // Persist rotated refresh token to Keychain so restarts use the latest
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
      try {
        const { execSync } = await import("child_process");
        execSync(
          `security delete-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN 2>/dev/null; ` +
          `security add-generic-password -a bing-ads-mcp -s BING_ADS_REFRESH_TOKEN -w "${data.refresh_token}"`,
        );
        console.error("[token] Rotated refresh token persisted to Keychain");
      } catch (err) {
        console.error("[token] WARNING: Failed to persist rotated refresh token to Keychain:", err);
      }
    }

    return this.accessToken!;
  }

  private getHeaders(client: ClientConfig): Record<string, string> {
    return {
      "Authorization": "", // Filled in by caller
      "DeveloperToken": this.developerToken,
      "CustomerId": client.customer_id,
      "CustomerAccountId": client.account_id,
      "Content-Type": "application/json",
    };
  }

  private async apiCall(url: string, body: any, client: ClientConfig): Promise<any> {
    const token = await this.getAccessToken();
    const headers = this.getHeaders(client);
    headers["Authorization"] = `Bearer ${token}`;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      const error = new Error(`Bing Ads API error: ${resp.status} ${text}`);
      (error as any).status = resp.status;
      throw classifyError(error);
    }

    return await resp.json();
  }

  private getClientForAccountId(accountId: string): ClientConfig | null {
    for (const client of Object.values(this.config.clients)) {
      if (client.account_id === accountId) {
        return client;
      }
    }
    return null;
  }

  // ============================================
  // CAMPAIGN MANAGEMENT
  // ============================================

  async listCampaigns(client: ClientConfig): Promise<any> {
    const url = `${CAMPAIGN_MGMT_BASE}/Campaigns/QueryByAccountId`;
    const body = {
      AccountId: client.account_id,
      CampaignType: "Search Shopping Audience PerformanceMax",
    };
    return await this.apiCall(url, body, client);
  }

  async listAdGroups(client: ClientConfig, campaignId: string): Promise<any> {
    const url = `${CAMPAIGN_MGMT_BASE}/AdGroups/QueryByCampaignId`;
    const body = {
      CampaignId: campaignId,
    };
    return await this.apiCall(url, body, client);
  }

  // ============================================
  // REPORTING
  // ============================================

  private async submitReport(client: ClientConfig, reportRequest: any): Promise<string> {
    const url = `${REPORTING_BASE}/GenerateReport/Submit`;
    const result = await this.apiCall(url, { ReportRequest: reportRequest }, client);
    return result.ReportRequestId;
  }

  private async pollReport(client: ClientConfig, requestId: string): Promise<{ status: string; url?: string }> {
    const url = `${REPORTING_BASE}/GenerateReport/Poll`;
    const result = await this.apiCall(url, { ReportRequestId: requestId }, client);
    return {
      status: result.ReportRequestStatus.Status,
      url: result.ReportRequestStatus.ReportDownloadUrl || undefined,
    };
  }

  private async downloadAndParseCsv(downloadUrl: string): Promise<any[]> {
    const resp = await fetch(downloadUrl);
    if (!resp.ok) {
      throw new Error(`Failed to download report: ${resp.status}`);
    }

    // The response is a ZIP file containing a CSV
    const buffer = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    // Parse ZIP to find CSV content
    // ZIP files have local file headers starting with PK\x03\x04
    const csvContent = await this.extractCsvFromZip(uint8);
    return this.parseCsv(csvContent);
  }

  private async extractCsvFromZip(zipData: Uint8Array): Promise<string> {
    // Simple ZIP extraction - find local file header and extract deflated data
    // ZIP local file header: PK\x03\x04
    const decoder = new TextDecoder();

    // Use Node's built-in zlib with a simple approach
    // The Bing Ads report ZIP typically has one file
    const { Readable } = await import("stream");
    const { createInflateRaw } = await import("zlib");

    // Find the local file header
    let offset = 0;
    if (zipData[0] !== 0x50 || zipData[1] !== 0x4B || zipData[2] !== 0x03 || zipData[3] !== 0x04) {
      // Not a ZIP, might be plain text or gzip
      return decoder.decode(zipData);
    }

    // Parse local file header
    const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
    const compressionMethod = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const fileNameLength = view.getUint16(26, true);
    const extraFieldLength = view.getUint16(28, true);
    const dataOffset = 30 + fileNameLength + extraFieldLength;

    const compressedData = zipData.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      // Stored (no compression)
      return decoder.decode(compressedData);
    } else if (compressionMethod === 8) {
      // Deflate
      return new Promise((resolve, reject) => {
        const inflate = createInflateRaw();
        const chunks: Buffer[] = [];
        inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
        inflate.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        inflate.on("error", reject);
        inflate.write(Buffer.from(compressedData));
        inflate.end();
      });
    }

    throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
  }

  private parseCsv(csvContent: string): any[] {
    const lines = csvContent.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Skip Bing report header lines (lines starting with "Report Name:", "Report Time:", etc.)
    // and the footer line (starting with "@" or "©")
    let headerIdx = -1;
    let dataEndIdx = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // The column header row is the first line that looks like CSV with quoted column names
      // and doesn't start with "Report " or "Time Zone" etc.
      if (line.startsWith('"Report ') || line.startsWith('"Time Zone') ||
          line.startsWith('"Last Completed') || line.startsWith('"Potential') ||
          line.startsWith('"Rows:') || line.startsWith('"Report Filter')) {
        continue;
      }
      if (line.startsWith('"@') || line.startsWith('"©')) {
        dataEndIdx = i;
        continue;
      }
      if (headerIdx === -1) {
        headerIdx = i;
      }
    }

    if (headerIdx === -1) {
      return [];
    }

    const headers = this.parseCsvLine(lines[headerIdx]);
    const rows: any[] = [];

    for (let i = headerIdx + 1; i < dataEndIdx; i++) {
      const line = lines[i];
      if (line.startsWith('"@') || line.startsWith('"©') || line.length === 0) continue;

      const values = this.parseCsvLine(line);
      const row: any = {};
      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        let val: any = values[j] || "";
        // Convert numeric-looking values
        if (/^-?\d+(\.\d+)?$/.test(val)) {
          val = parseFloat(val);
        }
        row[key] = val;
      }
      rows.push(row);
    }

    return rows;
  }

  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  async waitForReport(client: ClientConfig, requestId: string, maxWaitMs: number = 120000): Promise<any[]> {
    const start = Date.now();
    const pollInterval = 2000;

    while (Date.now() - start < maxWaitMs) {
      const result = await this.pollReport(client, requestId);

      if (result.status === "Success" && result.url) {
        return await this.downloadAndParseCsv(result.url);
      }
      if (result.status === "Error") {
        throw new Error("Report generation failed");
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Report timed out after ${maxWaitMs}ms`);
  }

  // ============================================
  // REPORT METHODS
  // ============================================

  async getCampaignPerformance(client: ClientConfig, options: {
    startDate: string; // YYYY-MM-DD
    endDate: string;
  }): Promise<any[]> {
    const [startYear, startMonth, startDay] = options.startDate.split("-").map(Number);
    const [endYear, endMonth, endDay] = options.endDate.split("-").map(Number);

    const reportRequest = {
      Type: "CampaignPerformanceReportRequest",
      ReportName: "Campaign Performance",
      Format: "Csv",
      FormatVersion: "2.0",
      ExcludeColumnHeaders: false,
      ExcludeReportFooter: true,
      ExcludeReportHeader: true,
      ReturnOnlyCompleteData: false,
      Aggregation: "Summary",
      Columns: [
        "AccountId",
        "CampaignId",
        "CampaignName",
        "CampaignStatus",
        "Impressions",
        "Clicks",
        "Ctr",
        "AverageCpc",
        "Spend",
        "Conversions",
        "ConversionRate",
        "CostPerConversion",
        "Revenue",
      ],
      Scope: {
        AccountIds: [parseInt(client.account_id)],
      },
      Time: {
        CustomDateRangeStart: { Year: startYear, Month: startMonth, Day: startDay },
        CustomDateRangeEnd: { Year: endYear, Month: endMonth, Day: endDay },
        ReportTimeZone: "PacificTimeUSCanadaTijuana",
      },
    };

    const requestId = await this.submitReport(client, reportRequest);
    return await this.waitForReport(client, requestId);
  }

  async getKeywordPerformance(client: ClientConfig, options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
  }): Promise<any[]> {
    const [startYear, startMonth, startDay] = options.startDate.split("-").map(Number);
    const [endYear, endMonth, endDay] = options.endDate.split("-").map(Number);

    const scope: any = {
      AccountIds: [parseInt(client.account_id)],
    };
    if (options.campaignIds && options.campaignIds.length > 0) {
      scope.Campaigns = options.campaignIds.map(id => ({
        AccountId: parseInt(client.account_id),
        CampaignId: parseInt(id),
      }));
    }

    const reportRequest = {
      Type: "KeywordPerformanceReportRequest",
      ReportName: "Keyword Performance",
      Format: "Csv",
      FormatVersion: "2.0",
      ExcludeColumnHeaders: false,
      ExcludeReportFooter: true,
      ExcludeReportHeader: true,
      ReturnOnlyCompleteData: false,
      Aggregation: "Summary",
      Columns: [
        "AccountId",
        "CampaignId",
        "CampaignName",
        "AdGroupId",
        "AdGroupName",
        "KeywordId",
        "Keyword",
        "KeywordStatus",
        "BidMatchType",
        "Impressions",
        "Clicks",
        "Ctr",
        "AverageCpc",
        "Spend",
        "QualityScore",
        "Conversions",
        "ConversionRate",
        "CostPerConversion",
        "Revenue",
      ],
      Scope: scope,
      Time: {
        CustomDateRangeStart: { Year: startYear, Month: startMonth, Day: startDay },
        CustomDateRangeEnd: { Year: endYear, Month: endMonth, Day: endDay },
        ReportTimeZone: "PacificTimeUSCanadaTijuana",
      },
      Sort: [{ SortColumn: "Spend", SortOrder: "Descending" }],
    };

    const requestId = await this.submitReport(client, reportRequest);
    return await this.waitForReport(client, requestId);
  }

  async getSearchTermReport(client: ClientConfig, options: {
    startDate: string;
    endDate: string;
    campaignIds?: string[];
  }): Promise<any[]> {
    const [startYear, startMonth, startDay] = options.startDate.split("-").map(Number);
    const [endYear, endMonth, endDay] = options.endDate.split("-").map(Number);

    const scope: any = {
      AccountIds: [parseInt(client.account_id)],
    };
    if (options.campaignIds && options.campaignIds.length > 0) {
      scope.Campaigns = options.campaignIds.map(id => ({
        AccountId: parseInt(client.account_id),
        CampaignId: parseInt(id),
      }));
    }

    const reportRequest = {
      Type: "SearchQueryPerformanceReportRequest",
      ReportName: "Search Term Report",
      Format: "Csv",
      FormatVersion: "2.0",
      ExcludeColumnHeaders: false,
      ExcludeReportFooter: true,
      ExcludeReportHeader: true,
      ReturnOnlyCompleteData: false,
      Aggregation: "Summary",
      Columns: [
        "AccountId",
        "CampaignId",
        "CampaignName",
        "AdGroupId",
        "AdGroupName",
        "KeywordId",
        "Keyword",
        "SearchQuery",
        "Impressions",
        "Clicks",
        "Ctr",
        "AverageCpc",
        "Spend",
        "Conversions",
        "ConversionRate",
        "CostPerConversion",
        "Revenue",
      ],
      Scope: scope,
      Time: {
        CustomDateRangeStart: { Year: startYear, Month: startMonth, Day: startDay },
        CustomDateRangeEnd: { Year: endYear, Month: endMonth, Day: endDay },
        ReportTimeZone: "PacificTimeUSCanadaTijuana",
      },
      Sort: [{ SortColumn: "Impressions", SortOrder: "Descending" }],
    };

    const requestId = await this.submitReport(client, reportRequest);
    return await this.waitForReport(client, requestId);
  }

  getConfig(): Config {
    return this.config;
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const adsManager = new BingAdsManager(config);

const server = new Server(
  {
    name: "mcp-bing-ads",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: "bing_ads_get_client_context",
    description: "Get the current client context based on working directory. Call this first to confirm which Bing Ads account you're working with.",
    inputSchema: {
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "bing_ads_list_campaigns",
    description: "List all campaigns for the current client's Bing/Microsoft Advertising account, including campaign name, status, budget, and type.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "The account ID (uses context if not provided)",
        },
      },
    },
  },
  {
    name: "bing_ads_get_campaign_performance",
    description: "Get campaign performance metrics (impressions, clicks, CTR, CPC, spend, conversions, revenue) for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_list_ad_groups",
    description: "List ad groups within a specific campaign, including ad group name and status.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        campaign_id: { type: "string", description: "The campaign ID to list ad groups for" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "bing_ads_keyword_performance",
    description: "Get keyword performance report with metrics including impressions, clicks, cost, conversions, quality score. Optionally filter by campaign.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "bing_ads_search_term_report",
    description: "Get search term report showing actual search queries that triggered ads, with matched keywords and performance metrics.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        start_date: { type: "string", description: "Start date YYYY-MM-DD" },
        end_date: { type: "string", description: "End date YYYY-MM-DD" },
        campaign_ids: { type: "array", items: { type: "string" }, description: "Filter by campaign IDs" },
      },
      required: ["start_date", "end_date"],
    },
  },
];

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Resolve client from account_id or working directory context
    const resolveClient = (accountId?: string): ClientConfig => {
      if (accountId) {
        for (const client of Object.values(config.clients)) {
          if (client.account_id === accountId) return client;
        }
        throw new Error(`No client found for account_id ${accountId}`);
      }
      // Default to first client
      const clients = Object.values(config.clients);
      if (clients.length === 0) throw new Error("No clients configured");
      return clients[0];
    };

    switch (name) {
      case "bing_ads_get_client_context": {
        const cwd = args?.working_directory as string;
        const client = getClientFromWorkingDir(config, cwd);
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No client found for working directory",
                working_directory: cwd,
                available_clients: Object.entries(config.clients).map(([k, v]) => ({
                  key: k,
                  name: v.name,
                  folder: v.folder,
                })),
              }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              client_name: client.name,
              customer_id: client.customer_id,
              account_id: client.account_id,
              folder: client.folder,
            }, null, 2),
          }],
        };
      }

      case "bing_ads_list_campaigns": {
        const client = resolveClient(args?.account_id as string);
        const result = await adsManager.listCampaigns(client);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "bing_ads_get_campaign_performance": {
        const client = resolveClient(args?.account_id as string);
        const result = await adsManager.getCampaignPerformance(client, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "bing_ads_list_ad_groups": {
        const client = resolveClient(args?.account_id as string);
        const campaignId = args?.campaign_id as string;
        const result = await adsManager.listAdGroups(client, campaignId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "bing_ads_keyword_performance": {
        const client = resolveClient(args?.account_id as string);
        const result = await adsManager.getKeywordPerformance(client, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          campaignIds: args?.campaign_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      case "bing_ads_search_term_report": {
        const client = resolveClient(args?.account_id as string);
        const result = await adsManager.getSearchTermReport(client, {
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          campaignIds: args?.campaign_ids as string[],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (rawError: any) {
    const error = classifyError(rawError);
    console.error(`[error] ${error.name}: ${error.message}`);

    const response: Record<string, unknown> = {
      error: true,
      error_type: error.name,
      message: error.message,
    };

    if (error instanceof BingAdsAuthError) {
      response.action_required = "Re-authenticate: refresh token may be expired. Update Keychain entry BING_ADS_REFRESH_TOKEN.";
    } else if (error instanceof BingAdsRateLimitError) {
      response.retry_after_ms = error.retryAfterMs;
      response.action_required = `Rate limited. Retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds.`;
    } else if (error instanceof BingAdsServiceError) {
      response.action_required = "Bing Ads API server error. This is transient — retry in a few minutes.";
    } else {
      response.details = rawError.stack;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  // Startup health check: verify OAuth token refresh works
  try {
    const mgr = new BingAdsManager(config);
    await (mgr as any).getAccessToken();
    console.error("[startup] Auth verified: OAuth token refresh succeeded");
  } catch (err: any) {
    console.error(`[STARTUP WARNING] Auth check FAILED: ${err.message}`);
    console.error(`[STARTUP WARNING] MCP will start but ALL API calls will fail until auth is fixed.`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[startup] MCP Bing Ads server running");
}

main().catch(console.error);
