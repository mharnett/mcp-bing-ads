/**
 * The Bing report download parser: the ZIP envelope and the CSV inside it.
 *
 * These were private methods on BingAdsManager in src/index.ts with no tests
 * (review 2026-11-14). They now live in src/reportCsv.ts. The ZIPs below are
 * built byte by byte with a local file header, the way the Reporting API's
 * download is laid out, so the offsets the parser reads are exercised.
 */

import { describe, expect, it } from "vitest";
import { deflateRawSync } from "zlib";
import { extractCsvFromZip, parseCsv, parseCsvLine } from "./reportCsv.js";

/** A one-entry ZIP: local file header, file name, then the (compressed) data. */
function zipOf(content: string, method: 0 | 8 | 12 = 8, name = "report.csv"): Uint8Array {
  const raw = Buffer.from(content, "utf-8");
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const fileName = Buffer.from(name, "utf-8");
  const extra = Buffer.from([0xaa, 0xbb, 0xcc]); // non-empty, so the extra-length offset matters
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(0, 14); // crc32 (not checked)
  header.writeUInt32LE(data.length, 18); // compressed size
  header.writeUInt32LE(raw.length, 22); // uncompressed size
  header.writeUInt16LE(fileName.length, 26);
  header.writeUInt16LE(extra.length, 28);
  // Trailing bytes stand in for the central directory, which must not leak into the CSV.
  return new Uint8Array(Buffer.concat([header, fileName, extra, data, Buffer.from("PK\x01\x02central-directory")]));
}

const CSV = [
  '"CampaignId","CampaignName","Impressions","Spend","Ctr"',
  '"300","Brand ""Core"", US","1200","45.67","3.10%"',
  '"301","Non-brand","0","0","0.00%"',
].join("\r\n");

describe("extractCsvFromZip", () => {
  it("inflates a deflated (method 8) entry", async () => {
    expect(await extractCsvFromZip(zipOf(CSV, 8))).toBe(CSV);
  });

  it("returns a stored (method 0) entry as is", async () => {
    expect(await extractCsvFromZip(zipOf(CSV, 0))).toBe(CSV);
  });

  it("passes a body that is not a ZIP through as text", async () => {
    expect(await extractCsvFromZip(new Uint8Array(Buffer.from(CSV)))).toBe(CSV);
  });

  it("refuses a compression method it cannot read rather than returning garbage", async () => {
    await expect(extractCsvFromZip(zipOf(CSV, 12))).rejects.toThrow(/Unsupported ZIP compression method: 12/);
  });
});

describe("parseCsv", () => {
  it("maps each row to the header columns, converting plain numbers", () => {
    expect(parseCsv(CSV)).toEqual([
      { CampaignId: 300, CampaignName: 'Brand "Core", US', Impressions: 1200, Spend: 45.67, Ctr: "3.10%" },
      { CampaignId: 301, CampaignName: "Non-brand", Impressions: 0, Spend: 0, Ctr: "0.00%" },
    ]);
  });

  it("skips the report header block and the copyright footer", () => {
    const withChrome = [
      '"Report Name: Campaign Performance"',
      '"Report Time: 11/1/2026"',
      '"Time Zone: (GMT-08:00) Pacific Time (US & Canada); Tijuana"',
      '"Last Completed Available Day: 11/20/2026 10:15:00 PM (GMT)"',
      '"Potential Incomplete Data: false"',
      '"Rows: 1"',
      '"Report Filter: "',
      "",
      '"CampaignId","Spend"',
      '"300","12.5"',
      "",
      '"©2026 Microsoft Corporation. All rights reserved. "',
    ].join("\n");
    expect(parseCsv(withChrome)).toEqual([{ CampaignId: 300, Spend: 12.5 }]);
  });

  it("returns no rows for an empty body or a header with no data", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv('"CampaignId","Spend"\n')).toEqual([]);
  });

  it("fills a missing trailing column with an empty string", () => {
    expect(parseCsv('"A","B","C"\n"1","x"')).toEqual([{ A: 1, B: "x", C: "" }]);
  });

  it("keeps negative and decimal numbers numeric but leaves grouped numbers as text", () => {
    expect(parseCsv('"A","B","C"\n"-3","0.25","1,234"')).toEqual([{ A: -3, B: 0.25, C: "1,234" }]);
  });
});

describe("parseCsvLine", () => {
  it("splits on commas outside quotes and unescapes doubled quotes", () => {
    expect(parseCsvLine('"a, b","say ""hi""",plain,')).toEqual(["a, b", 'say "hi"', "plain", ""]);
  });
});
