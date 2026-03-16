import { z } from "zod/v4";

// Action vocabulary is duplicated in two other locations:
// - Python types.py: action_to_diff_state() match statement
// - Python text.py: _ACTIONS dict (display config per action)
const knownActionTypes = [
  "",
  "skip",
  "resize",
  "update",
  "update_id",
  "create",
  "recreate",
  "delete",
] as const;

const actionTypeSchema = z.enum(knownActionTypes).catch("" as const);

export type ActionType = z.infer<typeof actionTypeSchema>;

const dependsOnEntrySchema = z
  .looseObject({
    node: z.string(),
    label: z.string().optional(),
  })
  .readonly();

const changeDescSchema = z
  .looseObject({
    action: actionTypeSchema,
    reason: z.string().optional(),
    old: z.unknown().optional(),
    new: z.unknown().optional(),
    remote: z.unknown().optional(),
  })
  .readonly();

export type ChangeDesc = z.infer<typeof changeDescSchema>;

const planEntrySchema = z
  .looseObject({
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
  .looseObject({
    plan_version: z.number().optional(),
    cli_version: z.string().optional(),
    lineage: z.string().optional(),
    serial: z.number().optional(),
    plan: z.record(z.string(), planEntrySchema).optional(),
  })
  .readonly();

export type Plan = z.infer<typeof planSchema>;
