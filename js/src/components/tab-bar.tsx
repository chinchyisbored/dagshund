type Tab = "jobs" | "resources";

type TabBarProps = {
  readonly activeTab: Tab;
  readonly onTabChange: (tab: Tab) => void;
  readonly counts: Readonly<Record<Tab, number>>;
};

type TabConfig = {
  readonly id: Tab;
  readonly label: string;
};

const TABS: readonly TabConfig[] = [
  { id: "resources", label: "Resources" },
  { id: "jobs", label: "Jobs" },
];

export function TabBar({ activeTab, onTabChange, counts }: TabBarProps) {
  return (
    <div className="flex border-b border-outline">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              isActive
                ? "border-b-2 border-ink text-ink"
                : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs text-ink-muted">({counts[tab.id]})</span>
          </button>
        );
      })}
    </div>
  );
}
