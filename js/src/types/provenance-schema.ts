import { z } from "zod/v4";

const sourcePlanSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const provenanceSchema = z
  .object({
    source_name: z.string(),
    source_modified_at: z.iso.datetime().nullable(),
    source_plan_sha256: sourcePlanSha256Schema,
    dagshund_version: z.string(),
    plan_cli_version: z.string().nullable(),
  })
  .readonly();

export type Provenance = z.infer<typeof provenanceSchema>;
