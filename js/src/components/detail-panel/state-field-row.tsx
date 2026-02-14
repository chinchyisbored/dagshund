import { useValueFormat } from "../../hooks/use-value-format.ts";
import { formatValue } from "../../utils/format-value.ts";
import { PrefixedBlock } from "../structural-diff-view.tsx";

const STATE_FIELD_STYLES: Readonly<
  Record<"added" | "removed", { readonly prefix: string; readonly text: string }>
> = {
  added: { prefix: "+", text: "text-diff-added" },
  removed: { prefix: "-", text: "text-diff-removed" },
};

export function StateFieldRow({
  fieldKey,
  value,
  variant,
}: {
  readonly fieldKey: string;
  readonly value: unknown;
  readonly variant: "added" | "removed";
}) {
  const format = useValueFormat();
  const style = STATE_FIELD_STYLES[variant];
  const formatted = formatValue(value, format);
  return (
    <div className="rounded border border-outline-subtle bg-surface-raised/30 px-3 py-2">
      <PrefixedBlock prefix={`${style.prefix} `} text={fieldKey} className={style.text} />
      <PrefixedBlock prefix={`${style.prefix}   `} text={formatted} className={style.text} />
    </div>
  );
}
