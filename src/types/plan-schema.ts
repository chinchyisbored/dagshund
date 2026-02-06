import { z } from "zod/v4";

export const actionTypeSchema = z.enum([
  "",
  "skip",
  "resize",
  "update",
  "update_id",
  "create",
  "recreate",
  "delete",
]);

export type ActionType = z.infer<typeof actionTypeSchema>;

export const dependsOnEntrySchema = z
  .object({
    node: z.string(),
    label: z.string().optional(),
  })
  .readonly();

export type DependsOnEntry = z.infer<typeof dependsOnEntrySchema>;

export const changeDescSchema = z
  .object({
    action: actionTypeSchema,
    reason: z.string().optional(),
    old: z.unknown().optional(),
    new: z.unknown().optional(),
    remote: z.unknown().optional(),
  })
  .readonly();

export type ChangeDesc = z.infer<typeof changeDescSchema>;

export const planEntrySchema = z
  .object({
    id: z.string().optional(),
    depends_on: z.array(dependsOnEntrySchema).readonly().optional(),
    action: actionTypeSchema.optional(),
    new_state: z.unknown().optional(),
    remote_state: z.unknown().optional(),
    changes: z.record(z.string(), changeDescSchema).optional(),
  })
  .readonly();

export type PlanEntry = z.infer<typeof planEntrySchema>;

export const planSchema = z
  .object({
    plan_version: z.number().optional(),
    cli_version: z.string().optional(),
    lineage: z.string().optional(),
    serial: z.number().optional(),
    plan: z.record(z.string(), planEntrySchema).optional(),
  })
  .readonly();

export type Plan = z.infer<typeof planSchema>;
