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

  const selectedChild = items.find((child) => child.id === selectedChildId) ?? items[0];

  if (items.length > 3) {
    return (
      <section className="mb-3" aria-label="자녀 선택" data-testid="guardian-child-switcher">
        <label className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-zinc-500">선택한 자녀</span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-zinc-950">
              {selectedChild.name} · {selectedChild.meta}
            </span>
          </span>
          <select
            aria-label="자녀 변경"
            className="h-11 max-w-36 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 outline-none transition focus:border-teal-500"
            data-testid="guardian-child-select"
            value={selectedChild.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {items.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}{child.statusLabel && child.statusLabel !== "활성" ? ` · ${child.statusLabel}` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>
    );
  }

  return (
    <section className="mb-3" aria-label="자녀 선택" data-testid="guardian-child-switcher">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {items.map((child) => {
          const selected = child.id === selectedChildId;

          return (
            <button
              aria-label={`${child.name}, ${child.meta}${child.statusLabel ? `, ${child.statusLabel}` : ""}`}
              className={`flex min-h-11 min-w-0 flex-col justify-center rounded-md border px-2 py-1.5 text-left transition ${
                selected
                  ? "border-brand-teal-700 bg-brand-teal-50 text-brand-teal-800"
                  : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
              }`}
              data-testid="guardian-child-chip"
              key={child.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(child.id)}
            >
              <span className="block min-w-0 truncate text-sm font-semibold">{child.name}</span>
              <span className="mt-0.5 block min-w-0 truncate text-[11px] font-medium leading-4 text-zinc-600">
                {child.meta}
                {child.statusLabel && child.statusLabel !== "활성" ? ` · ${child.statusLabel}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
