import { Check, Lock, Minus } from "lucide-react";

export type PermissionState = "allowed" | "denied" | "restricted";

export type PermissionMatrixRow = {
  resource: string;
  view: PermissionState;
  create: PermissionState;
  update: PermissionState;
  delete: PermissionState;
  approve: PermissionState;
};

const actionLabels = {
  view: "보기",
  create: "생성",
  update: "수정",
  delete: "삭제",
  approve: "승인",
} as const;

const stateLabels: Record<PermissionState, string> = {
  allowed: "허용",
  denied: "거부",
  restricted: "제한",
};

const stateClasses: Record<PermissionState, string> = {
  allowed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  denied: "border-zinc-200 bg-zinc-50 text-zinc-500",
  restricted: "border-red-200 bg-red-50 text-red-700",
};

function PermissionCell({ state }: { state: PermissionState }) {
  const Icon = state === "allowed" ? Check : state === "restricted" ? Lock : Minus;

  return (
    <span className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2 text-xs font-semibold ${stateClasses[state]}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {stateLabels[state]}
    </span>
  );
}

export function PermissionMatrix({ rows }: { rows: PermissionMatrixRow[] }) {
  return (
    <div>
      <div className="grid gap-3 sm:hidden">
        {rows.map((row) => (
          <article className="rounded-lg border border-zinc-200 bg-white p-3" key={row.resource}>
            <h3 className="text-sm font-semibold text-zinc-950">{row.resource}</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {Object.entries(actionLabels).map(([key, label]) => (
                <div className="min-w-0 rounded-md bg-zinc-50 px-2 py-2" key={key}>
                  <p className="mb-1 text-xs font-semibold text-zinc-500">{label}</p>
                  <PermissionCell state={row[key as keyof typeof actionLabels]} />
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="hidden min-w-[520px] overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block">
        <div className="grid grid-cols-[1.2fr_repeat(5,minmax(84px,1fr))] border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold text-zinc-500">
          <span>권한 항목</span>
          {Object.values(actionLabels).map((label) => (
            <span className="text-center" key={label}>
              {label}
            </span>
          ))}
        </div>
        <div className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <div className="grid grid-cols-[1.2fr_repeat(5,minmax(84px,1fr))] items-center gap-2 px-4 py-3" key={row.resource}>
              <p className="text-sm font-semibold text-zinc-950">{row.resource}</p>
              <div className="text-center">
                <PermissionCell state={row.view} />
              </div>
              <div className="text-center">
                <PermissionCell state={row.create} />
              </div>
              <div className="text-center">
                <PermissionCell state={row.update} />
              </div>
              <div className="text-center">
                <PermissionCell state={row.delete} />
              </div>
              <div className="text-center">
                <PermissionCell state={row.approve} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
