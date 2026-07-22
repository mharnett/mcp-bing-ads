import { describe, it, expect } from "vitest";
import {
  MAX_SHARED_ENTITY_IDS_PER_CALL,
  buildGetListItemsRequest,
  buildGetSharedEntityAssociationsRequest,
  buildGetSharedEntityAssociationsRequests,
  mergeAssociationResponses,
} from "./readRequests.js";

describe("buildGetListItemsRequest", () => {
  it("posts to the ListItems query resource with the shared list identified", () => {
    const req = buildGetListItemsRequest("228699360705206");
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/ListItems/QueryBySharedList");
    expect(req.body).toEqual({
      SharedList: { Id: 228699360705206, Type: "NegativeKeywordList" },
    });
  });

  it("coerces the id to a number — the API rejects string ids", () => {
    const req = buildGetListItemsRequest("123");
    expect((req.body.SharedList as { Id: unknown }).Id).toBe(123);
    expect(typeof (req.body.SharedList as { Id: unknown }).Id).toBe("number");
  });

  it("honours a non-default shared entity type", () => {
    const req = buildGetListItemsRequest("123", "NegativeKeywordListItem");
    expect((req.body.SharedList as { Type: unknown }).Type).toBe("NegativeKeywordListItem");
  });

  it("rejects an id that is not numeric rather than sending NaN", () => {
    expect(() => buildGetListItemsRequest("not-an-id")).toThrow(/numeric/i);
  });
});

describe("buildGetSharedEntityAssociationsRequest", () => {
  it("queries associations for a single shared entity id", () => {
    const req = buildGetSharedEntityAssociationsRequest("228699360705206");
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/SharedEntityAssociations/QueryBySharedEntityIds");
    // Both type fields are required — omitting SharedEntityType returns
    // CampaignServiceSharedEntityTypeNullOrEmpty (verified live 2026-07-22).
    expect(req.body).toEqual({
      EntityType: "Campaign",
      SharedEntityType: "NegativeKeywordList",
      SharedEntityIds: [228699360705206],
    });
  });

  it("honours non-default entity types", () => {
    const req = buildGetSharedEntityAssociationsRequest("1", "AdGroup", "PlacementExclusionList");
    expect(req.body.EntityType).toBe("AdGroup");
    expect(req.body.SharedEntityType).toBe("PlacementExclusionList");
  });

  it("rejects a non-numeric id rather than sending NaN", () => {
    expect(() => buildGetSharedEntityAssociationsRequest("abc")).toThrow(/numeric/i);
  });
});

describe("shared-entity batch limit", () => {
  it("is one — the API rejects two ids in a single call", () => {
    // Probed live 2026-07-22: n=1 returns 200, every n>=2 returns
    // CampaignServiceSharedEntityBatchLimitExceeded. Documented as a constant so
    // the fan-out below cannot silently regress into batching.
    expect(MAX_SHARED_ENTITY_IDS_PER_CALL).toBe(1);
  });

  it("fans several ids out to one request each", () => {
    const reqs = buildGetSharedEntityAssociationsRequests(["1", "2", "3"]);
    expect(reqs).toHaveLength(3);
    expect(reqs.map(r => r.body.SharedEntityIds)).toEqual([[1], [2], [3]]);
    for (const r of reqs) {
      expect((r.body.SharedEntityIds as number[]).length).toBeLessThanOrEqual(
        MAX_SHARED_ENTITY_IDS_PER_CALL,
      );
    }
  });

  it("rejects an empty id list — the API returns an unhelpful error for it", () => {
    expect(() => buildGetSharedEntityAssociationsRequests([])).toThrow(/at least one/i);
  });

  it("propagates type overrides to every request", () => {
    const reqs = buildGetSharedEntityAssociationsRequests(["1", "2"], "AdGroup");
    expect(reqs.every(r => r.body.EntityType === "AdGroup")).toBe(true);
  });
});

describe("mergeAssociationResponses", () => {
  it("concatenates Associations across the fanned-out responses", () => {
    const merged = mergeAssociationResponses([
      { Associations: [{ SharedEntityId: "1", EntityId: "10" }] },
      { Associations: [{ SharedEntityId: "2", EntityId: "20" }] },
    ]);
    expect(merged.Associations).toEqual([
      { SharedEntityId: "1", EntityId: "10" },
      { SharedEntityId: "2", EntityId: "20" },
    ]);
  });

  it("treats a response with no Associations as empty rather than throwing", () => {
    const merged = mergeAssociationResponses([{}, { Associations: [{ SharedEntityId: "1" }] }]);
    expect(merged.Associations).toHaveLength(1);
  });

  it("returns an empty array for no responses", () => {
    expect(mergeAssociationResponses([]).Associations).toEqual([]);
  });

  it("surfaces per-request errors instead of swallowing them", () => {
    const merged = mergeAssociationResponses([
      { Associations: [{ SharedEntityId: "1" }] },
      { OperationErrors: [{ ErrorCode: "CampaignServiceSharedEntityBatchLimitExceeded" }] },
    ]);
    expect(merged.Associations).toHaveLength(1);
    expect(merged.Errors).toHaveLength(1);
  });
});
