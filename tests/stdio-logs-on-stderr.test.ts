/**
 * On stdio, stdout carries MCP JSON-RPC only; every log line goes to stderr.
 *
 * MCP clients start this server with piped stdio and parse stdout as a stream
 * of JSON-RPC messages, so a log line on stdout corrupts the stream
 * (found by mcp-test-harness#10). This spawns the built entrypoint the way a
 * client does, sends initialize, tools/list and one read-only tools/call as
 * raw lines, and checks the raw bytes: every stdout line is a JSON-RPC 2.0
 * message, and the server's pino lines are on stderr.
 *
 * The tools/call is there because nothing logs through pino during startup
 * or tools/list here, so without it a server logging to stdout would pass.
 * The call fails on the no-network stub, and withResilience and the CallTool
 * handler both log that failure through pino.
 *
 * Raw pipes on purpose: the SDK client in src/entrypoint.test.ts drops stdout
 * lines it can't parse as JSON-RPC, so it passes with logs on stdout.
 *
 * NODE_ENV is unset on purpose. vitest sets NODE_ENV=test, and the logger
 * used to write to stderr only in that mode, so inheriting it hid the defect.
 *
 * Containment: tests/fixtures/no-network.mjs is preloaded, so every fetch in
 * the child rejects (Microsoft OAuth and the API), and the server reaches the
 * network only through fetch. The credentials are fakes and the token request
 * never succeeds, so the Keychain-persist branch cannot run. The call is
 * bing_ads_list_campaigns, a read.
 */

import { describe, expect, it } from "vitest";
import { spawn } from "child_process";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { pathToFileURL } from "url";

import { FAKE_ACCOUNT_ID, FAKE_ENV, TOKEN_URL } from "./helpers/fakeBingApi.js";

const ROOT = resolve(__dirname, "..");
const ENTRY = resolve(ROOT, "dist/index.js");
const NO_NETWORK = pathToFileURL(resolve(ROOT, "tests/fixtures/no-network.mjs")).href;

interface Session {
  stdout: string;
  stderr: string;
}

const linesOf = (text: string): string[] => text.split(/\r?\n/).filter((line) => line.trim() !== "");

function parseLine(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Start dist/index.js on piped stdio, run initialize, tools/list and one tools/call, and return everything it wrote. */
function runSession(env: Record<string, string>): Promise<Session> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", NO_NETWORK, ENTRY], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let scanned = 0;
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + "\n");
    const finish = () => {
      child.stdin.end();
      setTimeout(() => child.kill(), 2_000).unref();
    };
    const giveUp = setTimeout(finish, 20_000);

    child.stdin.on("error", () => {}); // EPIPE if the server exits early; the assertions report it
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      for (let nl = stdout.indexOf("\n", scanned); nl !== -1; nl = stdout.indexOf("\n", scanned)) {
        const message = parseLine(stdout.slice(scanned, nl));
        scanned = nl + 1;
        if (message?.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (message?.id === 2) {
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "bing_ads_list_campaigns", arguments: { account_id: FAKE_ACCOUNT_ID } },
          });
        } else if (message?.id === 3) {
          clearTimeout(giveUp);
          finish();
        }
      }
    });
    child.on("error", (err) => {
      stderr += `[spawn error] ${err.message}\n`;
    });
    child.on("close", () => {
      clearTimeout(giveUp);
      done({ stdout, stderr });
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "stdio-logs-test", version: "0.0.0" } },
    });
  });
}

describe("stdio: stdout is JSON-RPC only, logs go to stderr", () => {
  it("answers initialize, tools/list and tools/call on a clean stdout and writes its pino logs to stderr", async () => {
    const env: Record<string, string> = { ...getDefaultEnvironment(), ...FAKE_ENV };
    delete env.NODE_ENV;

    const { stdout, stderr } = await runSession(env);

    const stdoutLines = linesOf(stdout);
    const notJsonRpc = stdoutLines.filter((line) => parseLine(line)?.jsonrpc !== "2.0");
    expect(notJsonRpc, `stdout lines that are not JSON-RPC (server stderr follows):\n${stderr}`).toEqual([]);

    const byId = new Map(stdoutLines.map(parseLine).map((message) => [message.id, message]));
    expect(byId.get(1)?.result?.serverInfo?.name).toBe("mcp-bing-ads");
    expect(byId.get(2)?.result?.tools?.map((tool: any) => tool.name)).toContain("bing_ads_list_campaigns");
    expect(byId.get(3)?.result?.isError).toBe(true);

    const logs = linesOf(stderr)
      .map(parseLine)
      .filter((entry) => typeof entry?.level === "number");
    // The call's token request fails on the no-network stub (proving it went
    // nowhere), and withResilience logs the failure through pino.
    const callFailure = logs.find((entry) => entry.msg === "API call failed after retries" && entry.operation === "listCampaigns");
    expect(callFailure, `pino lines on stderr: ${JSON.stringify(logs)}`).toBeDefined();
    expect(callFailure.error).toBe(`network is disabled in this test (${TOKEN_URL})`);
    expect(logs.map((entry) => entry.msg)).toContain("Tool call failed");
  }, 30_000);
});
