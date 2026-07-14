import { useState } from "react";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type BudgetRow } from "../lib/api";
import { fmtMoney, fmtMonth, thisMonth, shiftMonth } from "../lib/format";
import { PageHeader } from "../components/Layout";
import {
  Card, CardHeader, Spinner, ErrorState, Modal, ProgressBar,
  inputCls, btnPrimary, btnGhost, Badge,
} from "../components/ui";
import { BudgetHistoryChart } from "../components/charts";

export function BudgetsPage() {
  const { household, access } = useSession();
  const hid = household!.id;
  const canEdit = access?.permission === "edit";
  const [month, setMonth] = useState(thisMonth());
  const [editing, setEditing] = useState<BudgetRow | null>(null);

  const budgets = useFetch<{ budgets: BudgetRow[] }>(`/api/households/${hid}/budgets?month=${month}`);
  const history = useFetch<{ history: { month: string; budgeted: number; spent: number }[] }>(
    `/api/households/${hid}/budgets/history?months=6`
  );

  const rows = budgets.data?.budgets ?? [];
  const budgetedRows = rows.filter((r) => r.budget);
  const unbudgeted = rows.filter((r) => !r.budget);
  const totBudget = budgetedRows.reduce((s, r) => s + r.budget!.amount + r.budget!.carry, 0);
  const totSpent = budgetedRows.reduce((s, r) => s + r.spent, 0);
  const remaining = totBudget - totSpent;

  return (
    <>
      <PageHeader
        title="Budgets"
        right={
          <div className="flex items-center gap-1 rounded-xl border border-hairline bg-card px-1 py-1">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2 py-1 text-ink-2 hover:text-ink" aria-label="Previous month">←</button>
            <span className="text-sm font-medium min-w-32 text-center">{fmtMonth(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2 py-1 text-ink-2 hover:text-ink" aria-label="Next month">→</button>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Budgeted", value: totBudget, cls: "" },
          { label: "Spent", value: totSpent, cls: "" },
          { label: "Remaining", value: remaining, cls: remaining >= 0 ? "text-pos-text" : "text-neg-text" },
        ].map((s) => (
          <Card key={s.label} className="px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">{s.label}</div>
            <div className={`tnum text-lg sm:text-xl font-semibold mt-0.5 ${s.cls}`}>{fmtMoney(s.value, { cents: false })}</div>
          </Card>
        ))}
      </div>

      <Card className="mb-5">
        <CardHeader title={`Category budgets — ${fmtMonth(month)}`} sub="Rollover categories carry unspent money forward" />
        <div className="px-5 pb-5">
          {budgets.loading && !budgets.data ? <Spinner /> :
           budgets.error ? <ErrorState message={budgets.error} retry={budgets.reload} /> : (
            <div className="space-y-5">
              {budgetedRows.map((b) => {
                const cap = b.budget!.amount + b.budget!.carry;
                return (
                  <div key={b.category.id}>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-sm mb-1.5">
                      <span className="flex items-center gap-2 font-medium">
                        <span aria-hidden>{b.category.icon}</span>{b.category.name}
                        {b.budget!.rollover && <Badge tone="blue">rollover{b.budget!.carry > 0 ? ` +${fmtMoney(b.budget!.carry, { cents: false })}` : ""}</Badge>}
                        {b.status === "over" && <Badge tone="red">over by {fmtMoney(b.spent - cap, { cents: false })}</Badge>}
                        {b.status === "close" && <Badge tone="amber">getting close</Badge>}
                      </span>
                      <span className="tnum text-ink-2">
                        {fmtMoney(b.spent, { cents: false })} of {fmtMoney(cap, { cents: false })}
                        {canEdit && (
                          <button onClick={() => setEditing(b)} className="ml-3 text-xs font-medium text-accent hover:text-accent-deep">Edit</button>
                        )}
                      </span>
                    </div>
                    <ProgressBar ratio={cap > 0 ? b.spent / cap : b.spent > 0 ? 1 : 0} status={b.status} />
                  </div>
                );
              })}
              {budgetedRows.length === 0 && (
                <p className="text-sm text-ink-3 py-4 text-center">No budgets set for this month yet.</p>
              )}
              {canEdit && unbudgeted.length > 0 && (
                <div className="pt-2 border-t border-hairline">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Not budgeted</div>
                  <div className="flex flex-wrap gap-2">
                    {unbudgeted.map((b) => (
                      <button key={b.category.id} onClick={() => setEditing(b)}
                        className="rounded-full border border-hairline px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-accent transition">
                        {b.category.icon} {b.category.name}
                        {b.spent > 0 && <span className="tnum text-ink-3 ml-1">({fmtMoney(b.spent, { cents: false })} spent)</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Budget vs. actual" sub="Last 6 months" />
        <div className="px-2 pb-3">
          {history.loading && !history.data ? <Spinner /> :
           history.error ? <ErrorState message={history.error} retry={history.reload} /> :
           <BudgetHistoryChart history={history.data!.history} />}
        </div>
      </Card>

      {editing && (
        <BudgetForm householdId={hid} month={month} row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); budgets.reload(); history.reload(); }} />
      )}
    </>
  );
}

function BudgetForm({ householdId, month, row, onClose, onSaved }: {
  householdId: number; month: string; row: BudgetRow; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState(row.budget ? String(row.budget.amount) : "");
  const [rollover, setRollover] = useState(row.budget?.rollover ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/households/${householdId}/budgets`, {
        category_id: row.category.id, month, amount: Number(amount), rollover,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!row.budget) return;
    setBusy(true);
    try {
      await api.del(`/api/households/${householdId}/budgets/${row.budget.id}`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${row.category.icon} ${row.category.name} — ${fmtMonth(month)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Monthly budget</label>
          <input autoFocus required type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0.00" />
          {row.spent > 0 && <p className="text-[11px] text-ink-3 mt-1">Spent so far this month: {fmtMoney(row.spent)}</p>}
        </div>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)}
            className="accent-[var(--color-accent)] h-4 w-4 mt-0.5" />
          <span>
            <span className="font-medium">Roll over unspent money</span>
            <span className="block text-xs text-ink-3">Leftover budget carries into next month</span>
          </span>
        </label>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {row.budget ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-neg-text hover:opacity-80">Remove budget</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
