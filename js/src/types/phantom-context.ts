type PhantomContextEntry = {
  readonly label: string;
  readonly resourceKey: string;
  readonly resourceType: string | undefined;
};

export type PhantomContext = {
  readonly sources: readonly PhantomContextEntry[];
};
