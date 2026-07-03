export type ChildSwitcherItem = {
  id: string;
  name: string;
  meta: string;
  statusLabel?: string;
};

export function ChildSwitcher({
  items,
  selectedChildId,
  onSelect,
}: {
  items: ChildSwitcherItem[];
  selectedChildId: string | null;
  onSelect: (childId: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mb-3" aria-label="자녀 선택" data-testid="guardian-child-switcher">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {items.map((child) => {
          const selected = child.id === selectedChildId;

          return (
            <button
              className={`flex min-h-11 min-w-0 flex-col justify-center rounded-md border px-2 py-1.5 text-left transition ${
                selected
                  ? "border-brand-navy-600 bg-brand-navy-50 text-brand-navy-900"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
              }`}
              data-testid="guardian-child-chip"
              key={child.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(child.id)}
            >
              <span className="block min-w-0 truncate text-sm font-semibold">{child.name}</span>
              <span className="mt-0.5 block min-w-0 truncate text-[11px] font-medium leading-4 text-zinc-600">{child.meta}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
