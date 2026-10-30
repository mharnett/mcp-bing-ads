/**
 * Request builders for Campaign Management v13 REST mutations.
 *
 * Kept as pure functions so the URL/method/body of every write operation is
 * unit-testable without spawning the server or mocking fetch. The REST API
 * maps SOAP operations onto resource-style URLs: reads are
 * `POST /{Entity}/QueryBy...`, updates are `PUT /{Entity}`, adds are
 * `POST /{Entity}` (AddListItemsToSharedList uses the `/ListItems` resource).
 */

export interface MutationRequest {
  /** Path relative to the CampaignManagement v13 base URL, e.g. "/Keywords". */
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body: Record<string, unknown>;
}

export function buildPauseKeywordsRequest(
  adGroupId: string,
  keywordIds: string[],
): MutationRequest {
  return {
    path: "/Keywords",
    method: "PUT",
    body: {
      AdGroupId: adGroupId,
      Keywords: keywordIds.map(id => ({
        Id: parseInt(id),
        Status: "Paused",
      })),
    },
  };
}

export function buildAddSharedNegativesRequest(
  sharedListId: string,
  keywords: Array<{ text: string; match_type?: string }>,
): MutationRequest {
  return {
    path: "/ListItems",
    method: "POST",
    body: {
      SharedList: {
        Id: parseInt(sharedListId),
        Type: "NegativeKeywordList",
      },
      ListItems: keywords.map(kw => ({
        Type: "NegativeKeyword",
        Text: kw.text,
        MatchType: kw.match_type || "Phrase",
      })),
    },
  };
}

/**
 * Upper bound on a settable CPC bid, in account currency.
 *
 * Not a policy about what a good bid is — purely a misplaced-decimal catch.
 * A budget error is self-limiting (the daily cap bounds the loss); a bid error
 * is not, since it applies to every click in every auction. The highest bid
 * this account has ever carried is $24, so $500 is ~20x headroom and still
 * catches a 10x or 100x fat-finger.
 */
export const MAX_SETTABLE_CPC_BID = 500;

/** Cent-level tolerance for comparing two currency amounts. */
const BID_EPSILON = 0.005;

export function buildUpdateAdGroupCpcBidRequest(
  campaignId: string,
  adGroupId: string,
  cpcBid: number,
): MutationRequest {
  if (!Number.isFinite(cpcBid)) {
    throw new Error(`CPC bid must be a finite number, got ${cpcBid}`);
  }
  if (cpcBid <= 0) {
    throw new Error(`CPC bid must be positive, got ${cpcBid}`);
  }
  if (cpcBid > MAX_SETTABLE_CPC_BID) {
    throw new Error(
      `CPC bid ${cpcBid} exceeds the fat-finger ceiling of ${MAX_SETTABLE_CPC_BID}. ` +
      `If this is deliberate, raise MAX_SETTABLE_CPC_BID rather than bypassing it.`,
    );
  }
  return {
    path: "/AdGroups",
    method: "PUT",
    body: {
      CampaignId: parseInt(campaignId),
      AdGroups: [{
        Id: parseInt(adGroupId),
        CpcBid: { Amount: cpcBid },
      }],
    },
  };
}

/**
 * Optimistic-concurrency guard for a bid write.
 *
 * `update_campaign_budget` has no equivalent: it writes whatever it is given,
 * so a caller working from a stale read silently overwrites someone else's
 * change. A bid deserves better, because the new value is almost always
 * computed *relative* to the current one ("halve it", "back to the old $12"),
 * which is exactly the reasoning that breaks when the current one has moved.
 *
 * Fails closed on a missing or unparseable live bid — treating "unknown" as
 * "matches" would turn the guard into decoration.
 */
export function assertAdGroupBidPrecondition(
  adGroups: Array<Record<string, any>>,
  adGroupId: string,
  expectedCurrentBid: number,
): void {
  const found = adGroups.find(ag => String(ag.Id) === String(adGroupId));
  if (!found) {
    throw new Error(
      `Ad group ${adGroupId} not found in the campaign's ad groups ` +
      `(saw: ${adGroups.map(ag => `${ag.Id}`).join(", ") || "none"}).`,
    );
  }
  const live = found.CpcBid?.Amount;
  const label = found.Name ? `"${found.Name}" (${adGroupId})` : `${adGroupId}`;
  if (typeof live !== "number" || !Number.isFinite(live)) {
    throw new Error(
      `Ad group ${label} has no readable CpcBid (got ${JSON.stringify(found.CpcBid)}), ` +
      `so the expected-bid precondition cannot be checked. Refusing to write.`,
    );
  }
  if (Math.abs(live - expectedCurrentBid) > BID_EPSILON) {
    throw new Error(
      `Bid precondition failed for ad group ${label}: expected ${expectedCurrentBid}, found ${live}. ` +
      `The ad group is not in the state this change was computed against — re-read and retry.`,
    );
  }
}

export function buildUpdateCampaignBudgetRequest(
  accountId: string,
  campaignId: string,
  dailyBudget: number,
): MutationRequest {
  return {
    path: "/Campaigns",
    method: "PUT",
    body: {
      AccountId: accountId,
      Campaigns: [{
        Id: parseInt(campaignId),
        DailyBudget: dailyBudget,
        BudgetType: "DailyBudgetStandard",
      }],
    },
  };
}

/**
 * Write a campaign budget, then read it back and assert it took.
 *
 * `PartialErrors: []` is not proof a write landed on this API: a $400 budget
 * write returned exactly that on 2026-08-24 and left the value at $100 for two
 * days. So success here means the value was re-read from the account. Fails
 * closed on a missing campaign or an unreadable budget.
 *
 * I/O is injected so the write-then-read ordering and the mismatch path are
 * unit-testable without the server or a live account.
 */
export async function updateCampaignBudgetVerified(
  deps: {
    write: () => Promise<any>;
    readCampaigns: () => Promise<any>;
  },
  campaignId: string,
  dailyBudget: number,
): Promise<any> {
  const writeResult = await deps.write();
  const after = await deps.readCampaigns();
  const campaigns: Array<Record<string, any>> = after?.Campaigns ?? [];
  const found = campaigns.find(c => String(c.Id) === String(campaignId));
  if (!found) {
    throw new Error(
      `Campaign ${campaignId} not found when reading the budget back after the write ` +
      `(the read-back lists Search campaigns only). The write may or may not have taken: ` +
      `check the budget in the Bing UI.`,
    );
  }
  const observed = found.DailyBudget;
  const label = found.Name ? `"${found.Name}" (${campaignId})` : `${campaignId}`;
  if (typeof observed !== "number" || Math.abs(observed - dailyBudget) > BID_EPSILON) {
    throw new Error(
      `Budget write did NOT take on campaign ${label}: asked for ${dailyBudget}, ` +
      `read back ${JSON.stringify(observed)}. The API reported ${JSON.stringify(writeResult)}, ` +
      `which on this API does not imply the value changed. Re-apply in the Bing UI and check ` +
      `for a shared budget on the campaign.`,
    );
  }
  return {
    ...writeResult,
    _verified: { campaign_id: campaignId, campaign_name: found.Name ?? null, new_budget: observed },
  };
}
