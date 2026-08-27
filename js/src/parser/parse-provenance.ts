import { type Provenance, provenanceSchema } from "../types/provenance-schema.ts";
import { err, ok, type Result } from "../types/result.ts";

export const parseProvenanceJson = (input: unknown): Result<Provenance | null, string> => {
  if (input === undefined || input === null) {
    return ok(null);
  }

  const result = provenanceSchema.safeParse(input);
  if (result.success) {
    return ok(result.data);
  }
  return err(result.error.message);
};
