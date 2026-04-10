import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { Plan } from "../../src/types/plan-schema.ts";

export const loadFixture = async (name: string): Promise<Plan> => {
  const text = await Bun.file(`../fixtures/golden/${name}/plan.json`).text();
  const result = parsePlanJson(JSON.parse(text));
  if (!result.ok) throw new Error(`Fixture parse failed: ${result.error}`);
  return result.data;
};
