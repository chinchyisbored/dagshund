import { type Result, ok, err } from "../types/result.ts";
import { type Plan, planSchema } from "../types/plan-schema.ts";

export const parsePlanJson = (input: unknown): Result<Plan, string> => {
  const result = planSchema.safeParse(input);
  if (result.success) {
    return ok(result.data);
  }
  return err(result.error.message);
};

export const parsePlanFromString = (jsonString: string): Result<Plan, string> => {
  try {
    const parsed: unknown = JSON.parse(jsonString);
    return parsePlanJson(parsed);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return err(`Invalid JSON: ${e.message}`);
    }
    return err("Unknown error parsing JSON");
  }
};
