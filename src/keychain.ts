import { execFileSync } from "child_process";

export const KEYCHAIN_ACCOUNT = "bing-ads-mcp";

/**
 * Build the `security` argv to upsert a generic-password item.
 *
 * Uses `-U` (update-or-insert) so the write is a SINGLE atomic call: there is
 * never a window where the entry is absent. This deliberately replaces the old
 * delete-generic-password + add-generic-password pattern, which could
 * permanently lose a rotating refresh token if the process died (or the add
 * threw) between the delete and the add. Microsoft rotates the Bing refresh
 * token on every refresh, so the in-memory copy is the only one — losing the
 * Keychain entry forces a full browser re-auth.
 */
export function buildKeychainUpsertArgs(
  service: string,
  secret: string,
  account: string = KEYCHAIN_ACCOUNT,
): string[] {
  return ["add-generic-password", "-a", account, "-s", service, "-w", secret, "-U"];
}

export type ExecFile = (file: string, args: string[], opts?: object) => unknown;

/**
 * Persist a secret to the macOS Keychain via a single atomic upsert.
 * Returns true on success, false on failure (never throws to the caller, so a
 * locked/denied Keychain degrades to "use this session's token" rather than
 * crashing the refresh path).
 */
export function persistSecretToKeychain(
  service: string,
  secret: string,
  exec: ExecFile = execFileSync,
  account: string = KEYCHAIN_ACCOUNT,
): boolean {
  try {
    exec("security", buildKeychainUpsertArgs(service, secret, account));
    return true;
  } catch {
    return false;
  }
}
