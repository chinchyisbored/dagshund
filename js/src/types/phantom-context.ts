export type PhantomContextEntry = {
  readonly label: string;
  readonly resourceKey: string;
  readonly resourceType: string | undefined;
};

export type PhantomContext = {
  readonly kind: "hierarchy" | "sync-target";
  readonly sources: readonly PhantomContextEntry[];
};
