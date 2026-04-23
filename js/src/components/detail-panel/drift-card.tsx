import { useValueFormat } from "../../hooks/use-value-format.ts";
import { formatValue } from "../../utils/format-value.ts";
import { stripTaskPrefix } from "../../utils/task-key.ts";
import { PrefixedBlock } from "../structural-diff-view.tsx";

export type DriftCardVariant = "reentry" | "removal";

type VariantStyle = {
  readonly keyPrefix: string;
  readonly valuePrefix: string;
  readonly textClass: string;
  readonly borderClass: string;
};

const VARIANT_STYLES: Readonly<Record<DriftCardVariant, VariantStyle>> = {
  reentry: {
    keyPrefix: "+ ",
    valuePrefix: "+   ",
    textClass: "text-diff-added",
    borderClass: "border-diff-added",
  },
  removal: {
    keyPrefix: "- ",
    valuePrefix: "-   ",
    textClass: "text-diff-removed",
    borderClass: "border-diff-removed",
  },
};

/** Single card row used by both drift sections. Dashed border + colored `+`/`-`
 *  prefixes mirror the ObjectStateCard / ChangeEntry convention so the drift
 *  entries scan the same way as a regular added/removed state field. */
export function DriftCard({
  fieldPath,
  value,
  variant,
}: {
  readonly fieldPath: string;
  readonly value: unknown;
  readonly variant: DriftCardVariant;
}) {
  const format = useValueFormat();
  const formatted = formatValue(value, format);
  const { keyPrefix, valuePrefix, textClass, borderClass } = VARIANT_STYLES[variant];

  return (
    <div className={`rounded border border-dashed ${borderClass} bg-surface-raised/50 px-3 py-2`}>
      <PrefixedBlock prefix={keyPrefix} text={stripTaskPrefix(fieldPath)} className={textClass} />
      <PrefixedBlock prefix={valuePrefix} text={formatted} className={textClass} />
    </div>
  );
}
