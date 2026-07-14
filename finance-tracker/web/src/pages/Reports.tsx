import { useMemo, useState } from "react";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { fmtMoney, fmtMonth, thisMonth, shiftMonth } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Card, CardHeader, Spinner, ErrorState, EmptyState, btnGhost, inputCls } from "../components/ui";
import { SpendingDonut, CashflowChart, NetBarChart } from "../components/charts";
import { POS_TEXT, NEG_TEXT } from "../lib/palette";

const PRESETS = [
  { label: "This month", days: 0 },
  { label: "Last 3 months", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "Last year", days: 365 },
];

function isoDaysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { household } = useSession();
  const hid = household!.id;

  const [preset, setPreset] = useState(180);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [calMonth, setCalMonth] = useState(thisMonth());

  const { start, end } = useMemo(() => {
    if (customStart && customEnd) return { start: customStart, end: customEnd };
    if (preset === 0) return { start: thisMonth() + "-01", end: isoDaysAgo(0) };
    return { start: isoDaysAgo(preset), end: isoDaysAgo(0) };
  }, [preset, customStart, customEnd]);

  const qs = `start=${start}&end=${end}`;
  const spending = useFetch<{ categories: { id: number | null; name: string; icon: string; total: number }[] }>(
    `/api/households/${hid}/reports/spending?${qs}`
  );
  const cashflow = useFetch<{ months: { month: string; income: number; expense: number; net: number }[] }>(
    `/api/households/${hid}/reports/cashflow?${qs}`
  );
  const calendar = useFetch<{ days: { date: string; net: number; count: number }[] }>(
    `/api/households/${hid}/reports/calendar?month=${calMonth}`
  );

  const totIncome = cashflow.data?.months.reduce((s, m) => s + m.income, 0) ?? 0;
  const totExpense = cashflow.data?.months.reduce((s, m) => s + m.expense, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Reports"
        right={
          <a href={`/api/households/${hid}/reports/export.csv?${qs}`} className={btnGhost} download>
            ⬇ Export CSV
          </a>
        }
      />

      {/* Range filters — one row above the charts */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button key={p.label}
              onClick={() => { setPreset(p.days); setCustomStart(""); setCustomEnd(""); }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
                !customStart && preset === p.days
                  ? "bg-navy-900 text-white border-navy-900"
                  : "border-hairline text-ink-2 hover:border-accent hover:text-accent"
              }`}>
              {p.label}
            </button>
          ))}
          <span className="text-xs text-ink-3 ml-1">or custom:</span>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
            className={`${inputCls} !w-auto !py-1.5 text-xs`} aria-label="Start date" />
          <span className="text-ink-3 text-xs">→</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
            className={`${inputCls} !w-auto !py-1.5 text-xs`} aria-label="End date" />
        </div>
      </Card>

      {/* Income / expense summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card className="px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Income</div>
          <div className="tnum text-lg sm:text-xl font-semibold mt-0.5" style={{ color: POS_TEXT }}>{fmtMoney(totIncome, { cents: false })}</div>
        </Card>
        <Card className="px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Spending</div>
          <div className="tnum text-lg sm:text-xl font-semibold mt-0.5" style={{ color: NEG_TEXT }}>{fmtMoney(totExpense, { cents: false })}</div>
        </Card>
        <Card className="px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Net</div>
          <div className={`tnum text-lg sm:text-xl font-semibold mt-0.5 ${totIncome - totExpense >= 0 ? "text-pos-text" : "text-neg-text"}`}>
            {fmtMoney(totIncome - totExpense, { cents: false })}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <Card>
          <CardHeader title="Spending by category" />
          <div className="px-5 pb-5">
            {spending.loading && !spending.data ? <Spinner /> :
             spending.error ? <ErrorState message={spending.error} retry={spending.reload} /> :
             (spending.data?.categories.length ?? 0) === 0 ? (
              <EmptyState icon="◔" title="No spending in this range" />
            ) : (
              <SpendingDonut categories={spending.data!.categories} height={230} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Income vs. spending" />
          <div className="px-2 pb-3">
            {cashflow.loading && !cashflow.data ? <Spinner /> :
             cashflow.error ? <ErrorState message={cashflow.error} retry={cashflow.reload} /> :
             (cashflow.data?.months.length ?? 0) === 0 ? (
              <EmptyState icon="▤" title="No activity in this range" />
            ) : (
              <CashflowChart months={cashflow.data!.months} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Monthly net" sub="Income minus spending" />
          <div className="px-2 pb-3">
            {cashflow.data && cashflow.data.months.length > 0
              ? <NetBarChart months={cashflow.data.months} />
              : <EmptyState icon="—" title="No data" />}
          </div>
        </Card>

        {/* Cash flow calendar */}
        <Card>
          <CardHeader
            title="Cash flow calendar"
            right={
              <div className="flex items-center gap-1">
                <button onClick={() => setCalMonth(shiftMonth(calMonth, -1))} className="px-2 text-ink-2 hover:text-ink" aria-label="Previous month">←</button>
                <span className="text-xs font-medium min-w-24 text-center">{fmtMonth(calMonth)}</span>
                <button onClick={() => setCalMonth(shiftMonth(calMonth, 1))} className="px-2 text-ink-2 hover:text-ink" aria-label="Next month">→</button>
              </div>
            }
          />
          <div className="px-5 pb-5">
            {calendar.loading && !calendar.data ? <Spinner /> : <CashCalendar month={calMonth} days={calendar.data?.days ?? []} />}
          </div>
        </Card>
      </div>
    </>
  );
}

function CashCalendar({ month, days }: { month: string; days: { date: string; net: number; count: number }[] }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startPad = first.getDay();
  const cells: (null | { day: number; net: number; count: number })[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    const info = byDate.get(key);
    cells.push({ day: d, net: info?.net ?? 0, count: info?.count ?? 0 });
  }
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-3 uppercase mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) =>
          c === null ? <div key={i} /> : (
            <div key={i}
              title={c.count ? `${c.count} transaction${c.count === 1 ? "" : "s"} · net ${fmtMoney(c.net)}` : undefined}
              className={`rounded-lg px-1 py-1.5 text-center border ${
                c.count === 0 ? "border-transparent text-ink-3"
                : c.net >= 0 ? "border-pos/25 bg-pos/10" : "border-neg/30 bg-neg/10"
              }`}>
              <div className="text-[10px] text-ink-3">{c.day}</div>
              {c.count > 0 && (
                <div className={`tnum text-[10px] font-semibold ${c.net >= 0 ? "text-pos-text" : "text-neg-text"}`}>
                  {c.net >= 0 ? "+" : "−"}{Math.abs(c.net) >= 1000 ? `${(Math.abs(c.net) / 1000).toFixed(1)}k` : Math.round(Math.abs(c.net))}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
