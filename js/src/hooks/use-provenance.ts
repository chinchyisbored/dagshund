import { useEffect, useState } from "react";
import { parseProvenanceJson } from "../parser/parse-provenance.ts";
import type { Provenance } from "../types/provenance-schema.ts";

declare global {
  interface Window {
    readonly __DAGSHUND_PROVENANCE__?: unknown;
  }
}

export const useProvenance = (): Provenance | null => {
  const [provenance, setProvenance] = useState<Provenance | null>(null);

  useEffect(() => {
    const result = parseProvenanceJson(window.__DAGSHUND_PROVENANCE__);
    if (!result.ok) {
      console.error(`dagshund: invalid provenance metadata: ${result.error}`);
    }
    // Provenance is optional metadata; invalid metadata should not prevent the plan from rendering.
    setProvenance(result.ok ? result.data : null);
  }, []);

  return provenance;
};
