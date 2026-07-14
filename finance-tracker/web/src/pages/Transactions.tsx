import { useMemo, useState, type FormEvent } from "react";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type Txn, type Account, type Category } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { PageHeader } from "../components/Layout";
import {
  Card, Money, Spinner, ErrorState, EmptyState, Modal,
  inputCls, btnPrimary, btnGhost, Badge,
} from "../components/ui";

const PAGE_SIZE = 50;

export function TransactionsPage() {
  const { household, access } = useSession();
  const hid = household!.id;
  const canEdit = access?.permission === "edit";

  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);

  const accounts = useFetch<{ accounts: Account[] }>(`/api/households/${hid}/accounts`);
  const categories = useFetch<{ categories: Category[] }>(`/api/households/${hid}/categories`);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(page * PAGE_SIZE));
    if (search) p.set("search", search);
    if (accountId) p.set("account_id", accountId);
    if (categoryId) p.set("category_id", categoryId);
    if (tag) p.set("tag", tag);
    return p.toString();
  }, [search, accountId, categoryId, tag, page]);

  const txns = useFetch<{ transactions: Txn[]; total: number }>(`/api/households/${hid}/transactions?${qs}`);
  const total = txns.data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkCategorize(catId: number | null) {
    await api.post(`/api/households/${hid}/transactions/bulk-categorize`, {
      ids: [...selected], category_id: catId,
    });
    setSelected(new Set());
    txns.reload();
  }

  const expenseCats = (categories.data?.categories ?? []).filter((c) => !c.archived);

  return (
    <>
      <PageHeader
        title="Transactions"
        sub={total ? `${total.toLocaleString()} transactions` : undefined}
        right={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}>+ Add transaction</button>}
      />

      {/* Filters */}
      <Card className="mb-4 p-4">
        <form
          className="grid grid-cols-2 md:grid-cols-5 gap-2"
          onSubmit={(e) => { e.preventDefault(); setSearch(searchDraft); setPage(0); }}
        >
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onBlur={() => { setSearch(searchDraft); setPage(0); }}
            placeholder="Search payee or notes…"
            className={`${inputCls} col-span-2`}
            aria-label="Search transactions"
          />
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(0); }} className={inputCls} aria-label="Filter by account">
            <option value="">All accounts</option>
            {(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(0); }} className={inputCls} aria-label="Filter by category">
            <option value="">All categories</option>
            <option value="none">Uncategorized</option>
            {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <input value={tag} onChange={(e) => { setTag(e.target.value); setPage(0); }} placeholder="Tag…" className={inputCls} aria-label="Filter by tag" />
        </form>
      </Card>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-navy-900 text-white px-4 py-2.5 shadow-(--shadow-pop)">
          <span className="text-sm">{selected.size} selected</span>
          <select
            className="rounded-lg bg-white/10 text-white text-sm px-2 py-1.5 border border-white/20"
            defaultValue=""
            onChange={(e) => { if (e.target.value) bulkCategorize(Number(e.target.value)); }}
            aria-label="Categorize selected as"
          >
            <option value="" disabled>Categorize as…</option>
            {expenseCats.map((c) => <option key={c.id} value={c.id} className="text-ink">{c.icon} {c.name}</option>)}
          </select>
          <button onClick={() => setSelected(new Set())} className="text-xs text-white/60 hover:text-white ml-auto">Clear</button>
        </div>
      )}

      <Card>
        {txns.loading && !txns.data ? <Spinner /> :
         txns.error ? <ErrorState message={txns.error} retry={txns.reload} /> :
         (txns.data?.transactions.length ?? 0) === 0 ? (
          <EmptyState icon="🔍" title={search || accountId || categoryId || tag ? "No matching transactions" : "No transactions yet"}
            body={search || accountId || categoryId || tag ? "Try loosening the filters." : "Add one manually or connect a bank to import them."} />
        ) : (
          <ul className="px-2 py-2">
            {txns.data!.transactions.map((t) => (
              <li key={t.id}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${selected.has(t.id) ? "bg-accent-soft" : "hover:bg-page"}`}>
                {canEdit && (
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select ${t.payee}`}
                    className="accent-[var(--color-accent)] h-4 w-4 shrink-0"
                  />
                )}
                <button
                  onClick={() => canEdit && setEditing(t)}
                  className="flex flex-1 items-center justify-between gap-3 min-w-0 text-left"
                  disabled={!canEdit}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl shrink-0" aria-hidden>{t.splits.length ? "🔀" : (t.category_icon ?? "❔")}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {t.payee || "(no payee)"}
                        {t.pending ? <Badge tone="gray">pending</Badge> : null}
                        {t.tags.map((tg) => <Badge key={tg} tone="blue">#{tg}</Badge>)}
                      </div>
                      <div className="text-xs text-ink-3 truncate">
                        {fmtDate(t.date)} · {t.splits.length ? `Split ${t.splits.length} ways` : (t.category_name ?? "Uncategorized")} · {t.account_name}
                      </div>
                    </div>
                  </div>
                  <Money value={t.amount} sign colored className="text-sm font-semibold shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3 text-sm">
            <button disabled={page === 0} onClick={() => setPage(page - 1)} className="text-accent disabled:text-ink-3">← Newer</button>
            <span className="text-ink-3 text-xs">Page {page + 1} of {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="text-accent disabled:text-ink-3">Older →</button>
          </div>
        )}
      </Card>

      {(adding || editing) && (
        <TxnForm
          householdId={hid}
          txn={editing ?? undefined}
          accounts={accounts.data?.accounts ?? []}
          categories={expenseCats}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); txns.reload(); }}
        />
      )}
    </>
  );
}

// ── Add/Edit modal with splits + tags ────────────────────────────────────
function TxnForm({ householdId, txn, accounts, categories, onClose, onSaved }: {
  householdId: number; txn?: Txn; accounts: Account[]; categories: Category[];
  onClose: () => void; onSaved: () => void;
}) {
  const isExpense = txn ? txn.amount < 0 : true;
  const [kind, setKind] = useState<"expense" | "income">(isExpense ? "expense" : "income");
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [amount, setAmount] = useState(txn ? String(Math.abs(txn.amount)) : "");
  const [date, setDate] = useState(txn?.date ?? new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(String(txn?.account_id ?? accounts[0]?.id ?? ""));
  const [categoryId, setCategoryId] = useState(String(txn?.category_id ?? ""));
  const [notes, setNotes] = useState(txn?.notes ?? "");
  const [tags, setTags] = useState(txn?.tags.join(", ") ?? "");
  const [splits, setSplits] = useState<{ category_id: string; amount: string }[]>(
    txn?.splits.map((s) => ({ category_id: String(s.category_id), amount: String(Math.abs(s.amount)) })) ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signed = (v: number) => (kind === "expense" ? -Math.abs(v) : Math.abs(v));
  const splitSum = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const amountNum = Number(amount) || 0;
  const splitsMismatch = splits.length > 0 && Math.abs(splitSum - amountNum) > 0.005;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (splitsMismatch) {
      setError(`Split amounts (${fmtMoney(splitSum)}) must add up to the total (${fmtMoney(amountNum)})`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        payee, notes, date,
        amount: signed(amountNum),
        account_id: Number(accountId),
        category_id: splits.length ? null : categoryId ? Number(categoryId) : null,
      };
      let id = txn?.id;
      if (txn) {
        await api.patch(`/api/households/${householdId}/transactions/${txn.id}`, body);
      } else {
        const res = await api.post<{ id: number }>(`/api/households/${householdId}/transactions`, body);
        id = res.id;
      }
      await api.put(`/api/households/${householdId}/transactions/${id}/splits`, {
        splits: splits.map((s) => ({ category_id: Number(s.category_id), amount: signed(Number(s.amount)) })),
      });
      await api.put(`/api/households/${householdId}/transactions/${id}/tags`, {
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!txn) return;
    if (!confirm("Delete this transaction?")) return;
    setBusy(true);
    try {
      await api.del(`/api/households/${householdId}/transactions/${txn.id}`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={txn ? "Edit transaction" : "Add transaction"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex rounded-xl border border-hairline overflow-hidden w-fit" role="group" aria-label="Type">
          {(["expense", "income"] as const).map((k) => (
            <button type="button" key={k} onClick={() => setKind(k)}
              className={`px-4 py-2 text-sm font-medium capitalize transition ${kind === k ? "bg-navy-900 text-white" : "text-ink-2 hover:bg-page"}`}>
              {k}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Payee</label>
            <input required value={payee} onChange={(e) => setPayee(e.target.value)} className={inputCls} placeholder="e.g. Greenleaf Market" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Amount</label>
            <input required type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Date</label>
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Account</label>
            <select required value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {splits.length === 0 && (
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1.5">Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                <option value="">Uncategorized</option>
                {categories.filter((c) => (kind === "income" ? c.is_income : !c.is_income)).map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5">Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} placeholder="vacation, reimbursable" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional" />
        </div>

        {/* Splits */}
        <div className="rounded-xl border border-hairline p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Split across categories</span>
            <button type="button" onClick={() => setSplits([...splits, { category_id: String(categories[0]?.id ?? ""), amount: "" }])}
              className="text-xs font-medium text-accent hover:text-accent-deep">+ Add split</button>
          </div>
          {splits.length === 0 ? (
            <p className="text-xs text-ink-3">Not split — the whole amount goes to one category.</p>
          ) : (
            <div className="space-y-2">
              {splits.map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select value={s.category_id}
                    onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, category_id: e.target.value } : x)))}
                    className={`${inputCls} flex-1`} aria-label={`Split ${i + 1} category`}>
                    {categories.filter((c) => !c.is_income).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0.01" value={s.amount} placeholder="0.00"
                    onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    className={`${inputCls} w-28`} aria-label={`Split ${i + 1} amount`} />
                  <button type="button" onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                    className="text-ink-3 hover:text-neg-text px-1" aria-label="Remove split">×</button>
                </div>
              ))}
              <p className={`text-xs ${splitsMismatch ? "text-neg-text" : "text-ink-3"}`}>
                Splits total {fmtMoney(splitSum)} of {fmtMoney(amountNum)}
              </p>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {txn ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-neg-text hover:opacity-80">Delete</button>
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
