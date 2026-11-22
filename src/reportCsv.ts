// Report download parsing, extracted from BingAdsManager so it can be unit
// tested. The Reporting API's download URL returns a one-entry ZIP holding a
// CSV with optional report header and copyright footer lines.

export async function extractCsvFromZip(zipData: Uint8Array): Promise<string> {
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

export function parseCsv(csvContent: string): any[] {
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

  const headers = parseCsvLine(lines[headerIdx]);
  const rows: any[] = [];

  for (let i = headerIdx + 1; i < dataEndIdx; i++) {
    const line = lines[i];
    if (line.startsWith('"@') || line.startsWith('"©') || line.length === 0) continue;

    const values = parseCsvLine(line);
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

// Handles escaped quote (double quote "") inside quoted fields, e.g. '"Campaign ""A, B"""'
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Handle double quote escape: "" -> "
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
