export type PhantomContextEntry = {
  readonly label: string;
  readonly resourceKey: string;
};

export type PhantomContext = {
  readonly kind: "hierarchy" | "sync-target";
  readonly sources: readonly PhantomContextEntry[];
};
