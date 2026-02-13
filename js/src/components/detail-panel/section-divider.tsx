export function SectionDivider({ label }: { readonly label: string }) {
  return (
    <div className="my-4 flex items-center gap-2">
      <div className="h-px flex-1 bg-outline-subtle" />
      <span className="whitespace-nowrap text-xs text-ink-muted">{label}</span>
      <div className="h-px flex-1 bg-outline-subtle" />
    </div>
  );
}
