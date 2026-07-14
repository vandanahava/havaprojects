import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { fmtMoney, thisMonth, fmtDateShort } from "../lib/format";
import { Card, CardHeader, Money, Spinner, ErrorState, EmptyState, ProgressBar, Badge } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { NetWorthChart } from "../components/charts";
import type { NetWorthPoint, BudgetRow, Txn, Goal } from "../lib/api";

const RANGES = [
  { label: "1M", days: 30 }, { label: "3M", days: 90 },
  { label: "6M", days: 180 }, { label: "1Y", days: 365 },
];

export function DashboardPage() {
  const { household } = useSession();
  const hid = household!.id;
  const [days, setDays] = useState(180);

  const nw = useFetch<{ series: NetWorthPoint[]; current: NetWorthPoint }>(
    `/api/households/${hid}/networth?days=${days}`
  );
  const budgets = useFetch<{ budgets: BudgetRow[] }>(`/api/households/${hid}/budgets?month=${thisMonth()}`);
  const txns = useFetch<{ transactions: Txn[] }>(`/api/households/${hid}/transactions?limit=8`);
  const goals = useFetch<{ goals: Goal[] }>(`/api/households/${hid}/goals`);
  const recurring = useFetch<{ recurring: any[] }>(`/api/households/${hid}/recurring`);

  const budgeted = budgets.data?.budgets.filter((b) => b.budget) ?? [];
  const worstFirst = [...budgeted].sort((a, b) => {
    const ra = a.budget!.amount + a.budget!.carry > 0 ? a.spent / (a.budget!.amount + a.budget!.carry) : 0;
    const rb = b.budget!.amount + b.budget!.carry > 0 ? b.spent / (b.budget!.amount + b.budget!.carry) : 0;
    return rb - ra;
  }).slice(0, 5);

  const change =
    nw.data && nw.data.series.length > 1
      ? nw.data.current.net - nw.data.series[0].net
      : 0;

  const upcoming = (recurring.data?.recurring ?? []).slice(0, 4);

  return (
    <>
      <PageHeader title="Dashboard" sub={`${household!.name} · at a glance`} />

      {/* Net worth hero */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-3">Net worth</div>
            {nw.loading && !nw.data ? (
              <div className="h-9 w-40 rounded bg-page animate-pulse mt-1" />
            ) : (
              <>
                <div className="tnum text-3xl font-semibold mt-0.5">
                  {fmtMoney(nw.data?.current.net ?? 0, { cents: false })}
                </div>
                <div className={`text-sm tnum mt-0.5 ${change >= 0 ? "text-pos-text" : "text-neg-text"}`}>
                  {change >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(change), { cents: false })} over this period
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <div className="text-xs text-ink-3">Assets</div>
              <Money value={nw.data?.current.assets ?? 0} cents={false} className="text-sm font-medium" />
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-xs text-ink-3">Liabilities</div>
              <Money value={-(nw.data?.current.liabilities ?? 0)} cents={false} className="text-sm font-medium" />
            </div>
            <div className="flex rounded-lg border border-hairline overflow-hidden" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.label} onClick={() => setDays(r.days)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition ${
                    days === r.days ? "bg-navy-900 text-white" : "text-ink-2 hover:bg-page"
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-2 pb-3 pt-1">
          {nw.error ? (
            <ErrorState message={nw.error} retry={nw.reload} />
          ) : nw.loading && !nw.data ? (
            <Spinner />
          ) : (nw.data?.series.length ?? 0) === 0 ? (
            <EmptyState icon="📈" title="No balance history yet"
              body="Add an account with a starting balance and your net worth trend will appear here."
              action={<Link to="/accounts" className="text-sm font-medium text-accent">Add an account →</Link>} />
          ) : (
            <NetWorthChart series={nw.data!.series} />
          )}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Budget snapshot */}
        <Card>
          <CardHeader title="Budgets this month" right={<Link to="/budgets" className="text-xs font-medium text-accent hover:text-accent-deep">View all →</Link>} />
          <div className="px-5 pb-5 space-y-4">
            {budgets.loading && !budgets.data ? <Spinner /> :
             budgets.error ? <ErrorState message={budgets.error} retry={budgets.reload} /> :
             worstFirst.length === 0 ? (
              <EmptyState icon="◔" title="No budgets set"
                body="Set monthly limits per category and track progress here."
                action={<Link to="/budgets" className="text-sm font-medium text-accent">Create a budget →</Link>} />
            ) : (
              worstFirst.map((b) => {
                const cap = b.budget!.amount + b.budget!.carry;
                return (
                  <div key={b.category.id}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="flex items-center gap-2">
                        <span aria-hidden>{b.category.icon}</span> {b.category.name}
                        {b.status === "over" && <Badge tone="red">over</Badge>}
                        {b.status === "close" && <Badge tone="amber">close</Badge>}
                      </span>
                      <span className="tnum text-ink-2">
                        {fmtMoney(b.spent, { cents: false })} <span className="text-ink-3">/ {fmtMoney(cap, { cents: false })}</span>
                      </span>
                    </div>
                    <ProgressBar ratio={cap > 0 ? b.spent / cap : 0} status={b.status} />
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Recent transactions */}
        <Card>
          <CardHeader title="Recent activity" right={<Link to="/transactions" className="text-xs font-medium text-accent hover:text-accent-deep">All transactions →</Link>} />
          <div className="px-2 pb-3">
            {txns.loading && !txns.data ? <Spinner /> :
             txns.error ? <ErrorState message={txns.error} retry={txns.reload} /> :
             (txns.data?.transactions.length ?? 0) === 0 ? (
              <EmptyState icon="⇄" title="No transactions yet" body="Add your first transaction or connect a bank." />
            ) : (
              <ul>
                {txns.data!.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-page transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg shrink-0" aria-hidden>{t.category_icon ?? "💳"}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{t.payee || "(no payee)"}</div>
                        <div className="text-xs text-ink-3 truncate">
                          {fmtDateShort(t.date)} · {t.account_name}
                        </div>
                      </div>
                    </div>
                    <Money value={t.amount} sign colored className="text-sm font-medium shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Upcoming bills */}
        <Card>
          <CardHeader title="Upcoming bills" right={<Link to="/recurring" className="text-xs font-medium text-accent hover:text-accent-deep">Recurring →</Link>} />
          <div className="px-5 pb-5">
            {recurring.loading && !recurring.data ? <Spinner /> :
             upcoming.length === 0 ? (
              <EmptyState icon="↻" title="Nothing detected yet"
                body="Recurring bills are detected automatically from repeated transactions." />
            ) : (
              <ul className="divide-y divide-hairline">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{r.payee}</div>
                      <div className="text-xs text-ink-3">due {fmtDateShort(r.next_due)} · {r.frequency}</div>
                    </div>
                    <Money value={-r.avg_amount} className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader title="Savings goals" right={<Link to="/goals" className="text-xs font-medium text-accent hover:text-accent-deep">Goals →</Link>} />
          <div className="px-5 pb-5 space-y-4">
            {goals.loading && !goals.data ? <Spinner /> :
             (goals.data?.goals.length ?? 0) === 0 ? (
              <EmptyState icon="◎" title="No goals yet" body="Set a savings target and watch it fill up." />
            ) : (
              goals.data!.goals.slice(0, 3).map((g) => (
                <div key={g.id}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="flex items-center gap-2"><span aria-hidden>{g.icon}</span>{g.name}</span>
                    <span className="tnum text-ink-2">
                      {fmtMoney(g.saved_amount, { cents: false })} <span className="text-ink-3">/ {fmtMoney(g.target_amount, { cents: false })}</span>
                    </span>
                  </div>
                  <ProgressBar ratio={g.saved_amount / g.target_amount} status="on_track" />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
