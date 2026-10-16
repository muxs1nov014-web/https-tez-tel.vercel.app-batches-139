interface TabItem<K extends string> {
  key: K;
  label: string;
}

interface TabsProps<K extends string> {
  tabs: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}

export function Tabs<K extends string>({ tabs, value, onChange }: TabsProps<K>) {
  return (
    <div className="mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex gap-0.5 rounded-[10px] bg-slate-200/60 p-[3px]" role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`whitespace-nowrap rounded-[7px] px-4 py-[5px] text-[13px] font-medium transition-all duration-200 ${
              active
                ? 'bg-surface text-slate-900 shadow-raised dark:bg-slate-400'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
      </div>
    </div>
  );
}
