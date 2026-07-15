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
