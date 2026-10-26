import type { PhantomKind } from "../utils/resource-key.ts";

export type ReferenceDirection = "entry-to-target" | "target-to-entry";

export type PhantomPlacement =
  | { readonly kind: "workspace-resource"; readonly resourceType: string }
  | { readonly kind: "hierarchy"; readonly identity: string; readonly tier: number }
  | { readonly kind: "uc-root" };

export type ReferenceResolution =
  | { readonly kind: "absent"; readonly sourceResourceKey: string }
  | {
      readonly kind: "unsupported";
      readonly sourceResourceKey: string;
      readonly diagnostic?: { readonly capability: string; readonly reason: string };
    }
  | {
      readonly kind: "resolved";
      readonly sourceResourceKey: string;
      readonly targetNodeId: string;
      readonly targetResourceKey?: string;
      readonly provenance: "real" | "derived";
      readonly direction: ReferenceDirection;
    }
  | {
      readonly kind: "phantom";
      readonly sourceResourceKey: string;
      readonly targetNodeId: string;
      readonly resourceKey: string;
      readonly label: string;
      readonly phantomKind: PhantomKind;
      readonly placement: PhantomPlacement;
      readonly direction: ReferenceDirection;
    };

export type ReferenceIdentityCatalog = {
  readonly nodeIdByResourceKey: ReadonlyMap<string, string>;
  readonly resourceKeyByAlias: ReadonlyMap<string, string>;
  readonly nodeIdByAlias: ReadonlyMap<string, string>;
  readonly postgresBranchIdentityByResourceKey: ReadonlyMap<string, string>;
  readonly postgresDatabaseIdentityByResourceKey: ReadonlyMap<string, string>;
  readonly postgresDatabaseResourceKeyByBranchRef: ReadonlyMap<string, string>;
  readonly postgresResourceKeyByIdentity: ReadonlyMap<string, string>;
};
