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
    <div className="flex border-b border-zinc-700">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-b-2 border-zinc-300 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
