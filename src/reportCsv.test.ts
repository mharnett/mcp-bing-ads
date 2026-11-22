/**
 * The Bing report download parser: the ZIP envelope and the CSV inside it.
 *
 * These were private methods on BingAdsManager in src/index.ts with no tests
 * (review 2026-11-14). They now live in src/reportCsv.ts. The ZIPs below are
 * built byte by byte with a local file header, the way the Reporting API's
 * download is laid out, so the offsets the parser reads are exercised.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
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

/**
 * A one-entry ZIP written the way a streaming writer does it: general-purpose
 * flag bit 3 set, CRC and sizes zero in the local header, the real values in
 * a data descriptor after the data and in the central directory.
 */
function zipWithDataDescriptor(
  content: string,
  method: 0 | 8 = 8,
  opts: { centralDirectory?: boolean; zip64Sizes?: boolean } = {},
): Uint8Array {
  const { centralDirectory = true, zip64Sizes = false } = opts;
  const raw = Buffer.from(content, "utf-8");
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const fileName = Buffer.from("report.csv", "utf-8");
  const extra = Buffer.from([0xaa, 0xbb, 0xcc]);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0008, 6); // bit 3: sizes follow in a data descriptor
  local.writeUInt16LE(method, 8);
  // crc32, compressed and uncompressed size stay 0 (offsets 14, 18, 22)
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(extra.length, 28);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(raw.length, 12);
  const body = Buffer.concat([local, fileName, extra, data, descriptor]);
  if (!centralDirectory) return new Uint8Array(body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0008, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(zip64Sizes ? 0xffffffff : data.length, 20);
  central.writeUInt32LE(zip64Sizes ? 0xffffffff : raw.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42); // local header at offset 0
  const cd = Buffer.concat([central, fileName]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, cd, eocd]));
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

  describe("with the data-descriptor flag (local header sizes are 0)", () => {
    it("inflates a deflated entry using the central directory's size", async () => {
      expect(await extractCsvFromZip(zipWithDataDescriptor(CSV, 8))).toBe(CSV);
    });

    it("reads the compressed size, not the uncompressed one (deflate output longer than its input)", async () => {
      expect(await extractCsvFromZip(zipWithDataDescriptor('"x"', 8))).toBe('"x"');
    });

    it("returns a stored entry whole, not as an empty string", async () => {
      expect(await extractCsvFromZip(zipWithDataDescriptor(CSV, 0))).toBe(CSV);
    });

    it("reads a ZIP written by Python's zipfile to an unseekable stream (tests/fixtures)", async () => {
      // Made with zipfile.ZipFile(<unseekable sink>, "w", ZIP_DEFLATED) and
      // zf.open(name, "w"): flag 0x0008, local sizes 0/0, sizes in the
      // descriptor and central directory. Synthetic rows, no account data.
      const zip = new Uint8Array(readFileSync(resolve(__dirname, "../tests/fixtures/report-data-descriptor.zip")));
      expect(new DataView(zip.buffer, zip.byteOffset).getUint32(18, true)).toBe(0);

      expect(parseCsv(await extractCsvFromZip(zip))).toEqual([
        { TimePeriod: "2026-11-20", CampaignId: 300, CampaignName: "Example Search", Impressions: 1200, Clicks: 34, Spend: 45.67 },
        { TimePeriod: "2026-11-20", CampaignId: 301, CampaignName: "Example Brand", Impressions: 80, Clicks: 9, Spend: 3.1 },
      ]);
    });

    it("refuses a ZIP with no central directory rather than returning nothing", async () => {
      await expect(extractCsvFromZip(zipWithDataDescriptor(CSV, 0, { centralDirectory: false }))).rejects.toThrow(
        /data descriptor.*central directory/i,
      );
    });

    it("refuses ZIP64 sizes it cannot read", async () => {
      await expect(extractCsvFromZip(zipWithDataDescriptor(CSV, 8, { zip64Sizes: true }))).rejects.toThrow(/ZIP64/);
    });
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
