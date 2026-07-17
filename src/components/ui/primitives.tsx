import Link from "next/link";
import { ArrowRight, Check, Clock, FileCheck2, MinusCircle } from "lucide-react";
import type { AttendanceStatus, DashboardMetric, PaymentStatus, UserRole } from "@/lib/domain";
import { attendanceStatusLabels, paymentStatusLabels, roleLabels } from "@/lib/roles";

type Tone = "neutral" | "good" | "warning" | "critical" | "info";

const toneClasses = {
  neutral: "border-zinc-200 bg-white text-zinc-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
} satisfies Record<Tone, string>;

const metricValueClasses: Record<Tone, string> = {
  neutral: "text-zinc-950",
  good: "text-zinc-950",
  warning: "text-zinc-950",
  critical: "text-zinc-950",
  info: "text-zinc-950",
};

type OperationalKpiCardProps = {
  actionHref?: string;
  actionLabel?: string;
  ariaLabel?: string;
  badge?: string;
  helper: string;
  label: string;
  testId?: string;
  tone?: Tone;
  value: string;
};

const buttonVariants = {
  primary: "border-brand-teal-700 bg-brand-teal-700 text-white hover:bg-brand-teal-800",
  secondary: "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
  ghost: "border-transparent bg-transparent text-zinc-700 hover:bg-zinc-100",
  danger: "border-red-600 bg-red-600 text-white hover:bg-red-700",
  success: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
} as const;

const buttonSizes = {
  sm: "min-h-11 px-2.5 text-xs lg:min-h-8",
  md: "min-h-11 px-3 text-sm lg:min-h-10",
  lg: "h-11 px-4 text-sm",
  touch: "min-h-12 px-3 text-sm",
} as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function Button({ className = "", variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      type={type}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-lg border border-zinc-200 bg-white p-4 ${className}`} {...props} />;
}

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-teal-200 bg-teal-50 px-2 text-xs font-semibold text-teal-800">
      {roleLabels[role]}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const tone =
    status === "paid"
      ? "good"
      : status === "overdue" || status === "refunded" || status === "partially_refunded" || status === "cancelled"
        ? "critical"
        : status === "expiringSoon"
          ? "warning"
          : "neutral";

  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${toneClasses[tone]}`}>{paymentStatusLabels[status]}</span>;
}

const attendanceToneClasses: Record<AttendanceStatus | "unchecked", string> = {
  present: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late: "border-amber-200 bg-amber-50 text-amber-700",
  absent: "border-red-200 bg-red-50 text-red-700",
  excused: "border-blue-200 bg-blue-50 text-blue-700",
  unchecked: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

const attendanceIcons: Record<AttendanceStatus, React.ComponentType<{ className?: string }>> = {
  present: Check,
  late: Clock,
  absent: MinusCircle,
  excused: FileCheck2,
};

export function AttendanceStatusBadge({ status }: { status?: AttendanceStatus }) {
  const current = status ?? "unchecked";

  return (
    <span className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${attendanceToneClasses[current]}`}>
      {status ? attendanceStatusLabels[status] : "미처리"}
    </span>
  );
}

export function AttendanceStatusButton({
  status,
  selected,
  onSelect,
  testId,
}: {
  status: AttendanceStatus;
  selected: boolean;
  onSelect: (status: AttendanceStatus) => void;
  testId?: string;
}) {
  const Icon = attendanceIcons[status];

  return (
    <button
      data-testid={testId}
      className={`inline-flex min-h-12 min-w-24 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold transition ${
        selected ? "border-zinc-950 bg-zinc-950 text-white" : `${attendanceToneClasses[status]} hover:brightness-95`
      }`}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(status)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {attendanceStatusLabels[status]}
    </button>
  );
}

export function OperationalKpiCard({
  actionHref,
  actionLabel,
  ariaLabel,
  badge,
  helper,
  label,
  testId,
  tone = "neutral",
  value,
}: OperationalKpiCardProps) {
  const summaryLabel = ariaLabel ?? `${label}. ${value}. ${helper}`;
  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[13px] font-semibold leading-4">{label}</p>
        {badge ? (
          <span className="shrink-0 rounded-md border border-white/70 bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold leading-4">
            {badge}
          </span>
        ) : null}
      </div>
      <p className={`mt-1 break-words text-[1.625rem] font-semibold leading-8 tracking-normal tabular-nums sm:text-3xl ${metricValueClasses[tone]}`}>
        {value}
      </p>
      <p className="mt-0.5 min-h-5 break-words text-xs leading-4 text-zinc-600">{helper}</p>
    </>
  );

  return (
    <article className={`min-w-0 rounded-lg border p-3 shadow-sm ${toneClasses[tone]}`} data-testid={testId}>
      {actionHref && actionLabel ? (
        <>
          <Link
            aria-label={summaryLabel}
            className="block min-w-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
            href={actionHref}
          >
            {content}
          </Link>
          <Link
            className="mt-1.5 inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-white/80 bg-white/75 px-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-white"
            href={actionHref}
          >
            <span className="min-w-0 break-words">{actionLabel}</span>
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        </>
      ) : (
        <div aria-label={summaryLabel}>{content}</div>
      )}
    </article>
  );
}

export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <OperationalKpiCard helper={metric.helper} label={metric.label} tone={metric.tone} value={metric.value} />
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">{title}</h1>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
