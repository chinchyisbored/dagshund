import type { NodeSearchEntry } from "./node-search-text.ts";

type SearchToken =
  | { readonly kind: "type"; readonly value: string }
  | { readonly kind: "status"; readonly value: string }
  | { readonly kind: "exact"; readonly value: string }
  | { readonly kind: "fuzzy"; readonly value: string };

/** Tokenize a raw query string, respecting quoted phrases. */
const tokenize = (query: string): readonly string[] => query.match(/"[^"]*"|\S+/g) ?? [];

/** Classify a single raw token into a SearchToken, or return undefined to drop it. */
const classifyToken = (raw: string): SearchToken | undefined => {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length > 2) {
    return { kind: "exact", value: raw.slice(1, -1) };
  }
  if (raw.startsWith("type:")) {
    const value = raw.slice(5);
    return value.length > 0 ? { kind: "type", value } : undefined;
  }
  if (raw.startsWith("status:")) {
    const value = raw.slice(7);
    return value.length > 0 ? { kind: "status", value } : undefined;
  }
  return { kind: "fuzzy", value: raw };
};

/** Parse a pre-lowercased, trimmed query into structured search tokens. */
export const parseSearchQuery = (query: string): readonly SearchToken[] =>
  tokenize(query).flatMap((raw) => {
    const token = classifyToken(raw);
    return token !== undefined ? [token] : [];
  });

/** Test whether a single token matches a search index entry. */
export const matchSearchToken = (token: SearchToken, entry: NodeSearchEntry): boolean => {
  switch (token.kind) {
    case "exact":
      return entry.label === token.value;
    case "type":
      return entry.badgeText.includes(token.value);
    case "status":
      return entry.diffState === token.value;
    case "fuzzy":
      return entry.text.includes(token.value);
  }
};
