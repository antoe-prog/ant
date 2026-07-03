import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/state-blocks";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyTitle = "표시할 항목이 없습니다",
  emptyDescription,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div
        className="hidden border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500 md:grid"
        style={{ gridTemplateColumns: columns.map(() => "minmax(0, 1fr)").join(" ") }}
      >
        {columns.map((column) => (
          <span className={column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""} key={column.key}>
            {column.header}
          </span>
        ))}
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <article
            className="block space-y-3 px-4 py-4 md:grid md:space-y-0 md:items-center"
            key={getRowKey(row)}
            style={{ gridTemplateColumns: columns.map(() => "minmax(0, 1fr)").join(" ") }}
          >
            {columns.map((column) => (
              <div className={column.align === "right" ? "md:text-right" : column.align === "center" ? "md:text-center" : ""} key={column.key}>
                <p className="mb-1 text-xs font-semibold text-zinc-500 md:hidden">{column.header}</p>
                {column.render(row)}
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
