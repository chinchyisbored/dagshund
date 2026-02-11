type Tab = "jobs" | "resources";

type TabBarProps = {
  readonly activeTab: Tab;
  readonly onTabChange: (tab: Tab) => void;
};

type TabConfig = {
  readonly id: Tab;
  readonly label: string;
};

const TABS: readonly TabConfig[] = [
  { id: "jobs", label: "Jobs" },
  { id: "resources", label: "Resources" },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
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
          </button>
        );
      })}
    </div>
  );
}
