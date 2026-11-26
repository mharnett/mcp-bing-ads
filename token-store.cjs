/**
 * Shared by the get-refresh-token helpers: where a minted token goes, and the
 * local callback listener. Nothing here ever prints a token. Helper output ends
 * up in terminal scrollback, logs and AI-assistant transcripts.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FALLBACK_DIR = path.join(os.homedir(), ".config", "mcp-bing-ads");

// `security -i` reads each command into a 4096-byte buffer. It splits a longer
// line and runs the first piece on its own, which stores a truncated secret in
// the default Keychain.
const MAX_COMMAND_BYTES = 4000;
const UNQUOTABLE = /["\\\x00-\x1f\x7f]/;

function keychainCommand({ account, service, secret }) {
  if ([account, service, secret].some((v) => UNQUOTABLE.test(v))) return null;
  const line = `add-generic-password -a "${account}" -s "${service}" -w "${secret}" -U\n`;
  return Buffer.byteLength(line) > MAX_COMMAND_BYTES ? null : line;
}

function writeOwnerOnly(dir, name, secret) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || /^\.+$/.test(name)) {
    throw Object.assign(new Error("not a usable file name"), { code: "EBADNAME" });
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, name);
  // Remove first, then create exclusively: an existing file would keep its
  // permissions, and a symlink would be written through.
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, secret, { mode: 0o600, flag: "wx" });
  return file;
}

/**
 * Saves to the macOS Keychain, or to an owner-only file where that is not
 * possible. The secret never goes into a process argument.
 */
function storeToken({ account, service, secret }, { platform = process.platform, spawn = spawnSync, dir = FALLBACK_DIR } = {}) {
  let keychainFailed = false;
  if (platform === "darwin") {
    const input = keychainCommand({ account, service, secret });
    // security's output is discarded because its errors quote the input.
    if (input && spawn("security", ["-i"], { input, stdio: ["pipe", "ignore", "ignore"] }).status === 0) {
      return { where: "keychain" };
    }
    keychainFailed = true;
  }
  try {
    return { where: "file", path: writeOwnerOnly(dir, service, secret), keychainFailed };
  } catch (e) {
    return { where: null, error: e.code || e.name };
  }
}

/** Where the token went and how to load it without displaying it. */
function describeStored(result, { account, service, envVar }) {
  if (result.where === "keychain") {
    return [
      `Saved to the Keychain: service ${service}, account ${account}.`,
      `To load it without displaying it:`,
      `  export ${envVar}="$(security find-generic-password -a ${account} -s ${service} -w)"`,
    ].join("\n");
  }
  if (result.where === "file") {
    return [
      ...(result.keychainFailed
        ? [`The Keychain write did not succeed. Any older Keychain entry for ${service} is unchanged.`]
        : []),
      `Saved to a file only your user can read: ${result.path}`,
      `To load it without displaying it:`,
      `  export ${envVar}="$(cat '${result.path}')"`,
      `Delete the file once the token is where your MCP client reads it.`,
    ].join("\n");
  }
  return `The token was NOT saved (${result.error}). It was not printed; fix the cause and run this again.`;
}

/** Names what went wrong in a token reply without repeating any value in it. */
function describeOAuthError(data) {
  if (data && data.error) return `${data.error}: ${data.error_description || "no description"}`;
  return `reply fields: ${Object.keys(data || {}).join(", ") || "none"}`;
}

/** A JSON parse error quotes the body it failed on, which can hold a token. */
function describeFailure(err) {
  if (err && err.name === "SyntaxError") return "the token endpoint's reply was not JSON";
  return (err && err.message) || String(err);
}

/**
 * Listens on both loopback addresses, because "localhost" in the redirect URI
 * can resolve to either. A port already in use is fatal: another process there
 * could receive the authorization code.
 */
async function listenLoopback(createServer, port) {
  const servers = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      servers.push(server);
    } catch (e) {
      // A machine with IPv6 turned off has no ::1 to bind.
      if (host === "::1" && (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT")) continue;
      for (const s of servers) s.close();
      throw e;
    }
  }
  return servers;
}

module.exports = {
  MAX_COMMAND_BYTES,
  storeToken,
  describeStored,
  describeOAuthError,
  describeFailure,
  listenLoopback,
};
