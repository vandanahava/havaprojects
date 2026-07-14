import { useState, type FormEvent } from "react";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type Goal } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Card, Spinner, ErrorState, EmptyState, Modal, ProgressBar, inputCls, btnPrimary, btnGhost } from "../components/ui";

export function GoalsPage() {
  const { household, access } = useSession();
  const hid = household!.id;
  const canEdit = access?.role !== "guest";
  const goals = useFetch<{ goals: Goal[] }>(`/api/households/${hid}/goals`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);

  return (
    <>
      <PageHeader
        title="Savings goals"
        sub="Set a target, contribute, and watch it fill"
        right={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}>+ New goal</button>}
      />
      {goals.loading && !goals.data ? <Card><Spinner /></Card> :
       goals.error ? <Card><ErrorState message={goals.error} retry={goals.reload} /></Card> :
       (goals.data?.goals.length ?? 0) === 0 ? (
        <Card>
          <EmptyState icon="◎" title="No goals yet"
            body="Create a savings goal — an emergency fund, a trip, a big purchase — and track progress toward it."
            action={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}>Create your first goal</button>} />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.data!.goals.map((g) => {
            const pct = Math.min(g.saved_amount / g.target_amount, 1);
            const done = g.saved_amount >= g.target_amount;
            return (
              <Card key={g.id} className="p-5 flex flex-col">
                <div className="flex items-start justify-between">
                  <div className="text-3xl" aria-hidden>{g.icon}</div>
                  {done && <span className="text-xs font-semibold text-pos-text">✓ Reached!</span>}
                </div>
                <h2 className="text-[15px] font-semibold mt-2">{g.name}</h2>
                <div className="tnum text-2xl font-semibold mt-1">
                  {fmtMoney(g.saved_amount, { cents: false })}
                  <span className="text-sm text-ink-3 font-normal"> of {fmtMoney(g.target_amount, { cents: false })}</span>
                </div>
                {g.target_date && (
                  <div className="text-xs text-ink-3 mt-0.5">target: {fmtDate(g.target_date)}</div>
                )}
                <div className="mt-3">
                  <ProgressBar ratio={pct} status="on_track" />
                  <div className="text-[11px] text-ink-3 mt-1">{Math.round(pct * 100)}% there</div>
                </div>
                {canEdit && (
                  <div className="flex gap-2 mt-4 pt-3 border-t border-hairline">
                    <button onClick={() => setContributing(g)} className="text-xs font-medium text-accent hover:text-accent-deep">+ Contribute</button>
                    <button onClick={() => setEditing(g)} className="text-xs text-ink-3 hover:text-ink ml-auto">Edit</button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {(adding || editing) && (
        <GoalForm householdId={hid} goal={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); goals.reload(); }} />
      )}
      {contributing && (
        <ContributeForm householdId={hid} goal={contributing}
          onClose={() => setContributing(null)}
          onSaved={() => { setContributing(null); goals.reload(); }} />
      )}
    </>
  );
}

function GoalForm({ householdId, goal, onClose, onSaved }: {
  householdId: number; goal?: Goal; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [icon, setIcon] = useState(goal?.icon ?? "🎯");
  const [target, setTarget] = useState(goal ? String(goal.target_amount) : "");
  const [date, setDate] = useState(goal?.target_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, icon, target_amount: Number(target), target_date: date || null };
      if (goal) await api.patch(`/api/households/${householdId}/goals/${goal.id}`, body);
      else await api.post(`/api/households/${householdId}/goals`, body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!goal || !confirm(`Delete goal "${goal.name}"?`)) return;
    await api.del(`/api/households/${householdId}/goals/${goal.id}`);
    onSaved();
  }

  return (
    <Modal title={goal ? "Edit goal" : "New savings goal"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[64px_1fr] gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Icon</label>
            <input value={icon} onChange={(e) => setIcon(e.target.value)} className={`${inputCls} text-center`} maxLength={4} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Goal name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Emergency Fund" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Target amount</label>
          <input required type="number" min="1" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls} placeholder="10000" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Target date (optional)</label>
          <input type="date" value={date ?? ""} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {goal ? <button type="button" onClick={remove} className="text-sm text-neg-text hover:opacity-80">Delete</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ContributeForm({ householdId, goal, onClose, onSaved }: {
  householdId: number; goal: Goal; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/api/households/${householdId}/goals/${goal.id}/contribute`, { amount: Number(amount) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Contribute to ${goal.icon} ${goal.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Amount (negative to withdraw)</label>
          <input autoFocus required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="250" />
          <p className="text-[11px] text-ink-3 mt-1">
            Currently {fmtMoney(goal.saved_amount)} of {fmtMoney(goal.target_amount)}
          </p>
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Contribute"}</button>
        </div>
      </form>
    </Modal>
  );
}
