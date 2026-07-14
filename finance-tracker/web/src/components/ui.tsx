import { type ReactNode, useEffect } from "react";
import { fmtMoney } from "../lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-card rounded-2xl shadow-(--shadow-card) border border-black/[0.03] ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-2">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {sub && <p className="text-xs text-ink-3 mt-0.5">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Money({
  value, sign = false, cents = true, colored = false, className = "",
}: {
  value: number; sign?: boolean; cents?: boolean; colored?: boolean; className?: string;
}) {
  const color = !colored ? "" : value > 0 ? "text-pos-text" : value < 0 ? "text-neg-text" : "text-ink-2";
  return <span className={`tnum ${color} ${className}`}>{fmtMoney(value, { sign, cents })}</span>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-3" role="status">
      <div className="h-6 w-6 rounded-full border-2 border-hairline border-t-accent animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon, title, body, action,
}: { icon: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
      <div className="text-4xl mb-1" aria-hidden>{icon}</div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {body && <p className="text-sm text-ink-3 max-w-sm">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
      <div className="text-3xl" aria-hidden>⚠️</div>
      <h3 className="text-[15px] font-semibold text-ink">Something went wrong</h3>
      <p className="text-sm text-ink-3 max-w-sm">{message}</p>
      {retry && (
        <button onClick={retry} className="mt-2 text-sm font-medium text-accent hover:text-accent-deep">
          Try again
        </button>
      )}
    </div>
  );
}

export function Modal({
  title, onClose, children, wide = false,
}: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-navy-900/40 backdrop-blur-[2px] p-0 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-card w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} rounded-t-2xl sm:rounded-2xl shadow-(--shadow-pop) max-h-[92vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline sticky top-0 bg-card rounded-t-2xl">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-3 hover:text-ink text-xl leading-none px-1">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ProgressBar({
  ratio, status,
}: { ratio: number; status: "on_track" | "close" | "over" | "unbudgeted" }) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100;
  const color =
    status === "over" ? "bg-neg" : status === "close" ? "bg-warn" : "bg-pos";
  return (
    <div className="h-2 w-full rounded-full bg-page overflow-hidden" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-hairline bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition";
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent text-white text-sm font-medium px-4 py-2.5 hover:bg-accent-deep active:scale-[0.99] transition disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline bg-card text-sm font-medium text-ink-2 px-4 py-2.5 hover:bg-page hover:text-ink transition disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-neg-text text-white text-sm font-medium px-4 py-2.5 hover:opacity-90 transition disabled:opacity-50";

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "blue" | "green" | "red" | "amber" }) {
  const tones: Record<string, string> = {
    gray: "bg-page text-ink-2 border-hairline",
    blue: "bg-accent-soft text-accent-deep border-accent/20",
    green: "bg-pos/10 text-pos-text border-pos/20",
    red: "bg-neg/10 text-neg-text border-neg/30",
    amber: "bg-warn/10 text-[#8a6100] border-warn/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
