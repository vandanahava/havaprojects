import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type Account } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { PageHeader } from "../components/Layout";
import { Card, Money, Spinner, ErrorState, EmptyState, Modal, inputCls, btnPrimary, btnGhost, Badge } from "../components/ui";
import { PlaidConnectButton } from "../components/PlaidConnect";

const TYPE_LABEL: Record<string, string> = {
  checking: "Checking", savings: "Savings", credit: "Credit cards", loan: "Loans",
  investment: "Investments", cash: "Cash", property: "Property",
};
const TYPE_ORDER = ["checking", "savings", "investment", "cash", "property", "credit", "loan"];

interface PlaidItemInfo {
  id: number; institution_name: string; status: string; last_synced_at: string | null; account_count: number;
}

export function AccountsPage() {
  const { household, access } = useSession();
  const hid = household!.id;
  const accounts = useFetch<{ accounts: Account[] }>(`/api/households/${hid}/accounts`);
  const plaid = useFetch<{ configured: boolean; env: string; items: PlaidItemInfo[] }>(
    `/api/households/${hid}/plaid/status`
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const canManage = access?.role !== "guest";

  const grouped = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const a of accounts.data?.accounts ?? []) {
      if (!map.has(a.type)) map.set(a.type, []);
      map.get(a.type)!.push(a);
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, accounts: map.get(t)! }));
  }, [accounts.data]);

  const needsReconnect = (plaid.data?.items ?? []).filter((i) => i.status === "login_required");

  function refreshAll() {
    accounts.reload();
    plaid.reload();
  }

  async function syncItem(id: number) {
    try {
      await api.post(`/api/households/${hid}/plaid/items/${id}/sync`);
      refreshAll();
    } catch { /* status endpoint will show the error state */ }
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        sub="Manual and connected accounts, together"
        right={canManage && (
          <>
            {plaid.data?.configured ? (
              <PlaidConnectButton householdId={hid} onSuccess={refreshAll} />
            ) : (
              <span className="text-xs text-ink-3 max-w-[220px] text-right hidden sm:block">
                Add Plaid sandbox keys in <code>.env</code> to enable bank connections
              </span>
            )}
            <button onClick={() => setAdding(true)} className={btnGhost}>+ Manual account</button>
          </>
        )}
      />

      {/* Reconnect banner — never fail silently */}
      {needsReconnect.map((item) => (
        <div key={item.id} className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-5 py-3.5">
          <div className="text-sm">
            <span className="font-semibold">⚠️ {item.institution_name}</span>{" "}
            <span className="text-ink-2">needs to be re-authenticated before it can sync again.</span>
          </div>
          <PlaidConnectButton householdId={hid} plaidItemId={item.id} onSuccess={refreshAll} />
        </div>
      ))}

      {accounts.loading && !accounts.data ? (
        <Card><Spinner /></Card>
      ) : accounts.error ? (
        <Card><ErrorState message={accounts.error} retry={accounts.reload} /></Card>
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState icon="🏦" title="No accounts yet"
            body="Add a manual account with a balance, or connect your bank through Plaid to import accounts and transactions automatically."
            action={canManage && <button onClick={() => setAdding(true)} className={btnPrimary}>Add your first account</button>} />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => {
            const subtotal = group.accounts.reduce(
              (s, a) => s + (a.is_liability ? -Math.abs(a.current_balance) : a.current_balance), 0
            );
            return (
              <Card key={group.type}>
                <div className="flex items-center justify-between px-5 pt-4 pb-1">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                    {TYPE_LABEL[group.type]}
                  </h2>
                  <Money value={subtotal} cents={false} className="text-sm font-semibold" colored={group.type === "credit" || group.type === "loan"} />
                </div>
                <ul className="px-2 pb-2">
                  {group.accounts.map((a) => (
                    <li key={a.id}>
                      <Link to={`/accounts/${a.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl hover:bg-page transition">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{a.name}</span>
                            {a.source === "plaid" ? (
                              a.plaid_status === "login_required"
                                ? <Badge tone="amber">reconnect needed</Badge>
                                : <Badge tone="blue">via {a.institution_name || "bank"}</Badge>
                            ) : (
                              <Badge tone="gray">Manual</Badge>
                            )}
                          </div>
                          {a.institution_name && a.source === "manual" && (
                            <div className="text-xs text-ink-3 mt-0.5">{a.institution_name}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <Money
                            value={a.is_liability ? -Math.abs(a.current_balance) : a.current_balance}
                            colored={a.is_liability}
                            className="text-sm font-semibold"
                          />
                          {canManage && a.source === "manual" && (
                            <button
                              onClick={(e) => { e.preventDefault(); setEditing(a); }}
                              className="text-xs text-ink-3 hover:text-accent"
                              aria-label={`Edit ${a.name}`}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          {/* Connections management */}
          {(plaid.data?.items.length ?? 0) > 0 && (
            <Card>
              <div className="px-5 pt-4 pb-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
                Bank connections
              </div>
              <ul className="px-5 pb-4 divide-y divide-hairline">
                {plaid.data!.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <div>
                      <div className="font-medium">{item.institution_name}</div>
                      <div className="text-xs text-ink-3">
                        {item.account_count} account{item.account_count === 1 ? "" : "s"} ·{" "}
                        {item.status === "ok"
                          ? `last synced ${item.last_synced_at ? new Date(item.last_synced_at + "Z").toLocaleString() : "never"}`
                          : item.status === "login_required" ? "needs re-authentication" : "sync error"}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex gap-2">
                        <button onClick={() => syncItem(item.id)} className="text-xs font-medium text-accent hover:text-accent-deep">Sync now</button>
                        <button
                          onClick={async () => {
                            if (confirm(`Disconnect ${item.institution_name}? Its accounts become manual and keep their history.`)) {
                              await api.del(`/api/households/${hid}/plaid/items/${item.id}`);
                              refreshAll();
                            }
                          }}
                          className="text-xs font-medium text-neg-text hover:opacity-80"
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {adding && <AccountForm householdId={hid} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refreshAll(); }} />}
      {editing && <AccountForm householdId={hid} account={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refreshAll(); }} />}
    </>
  );
}

function AccountForm({ householdId, account, onClose, onSaved }: {
  householdId: number; account?: Account; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState(account?.type ?? "checking");
  const [balance, setBalance] = useState(account ? String(Math.abs(account.current_balance)) : "");
  const [institution, setInstitution] = useState(account?.institution_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const bal = Number(balance || 0);
      if (account) {
        await api.patch(`/api/households/${householdId}/accounts/${account.id}`, {
          name, balance: bal, institution_name: institution,
        });
      } else {
        await api.post(`/api/households/${householdId}/accounts`, {
          name, type, balance: bal, institution_name: institution || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!account) return;
    if (!confirm(`Delete "${account.name}" and all its transactions? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/households/${householdId}/accounts/${account.id}`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={account ? "Edit account" : "Add manual account"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5" htmlFor="acct-name">Account name</label>
          <input id="acct-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Joint Checking" />
        </div>
        {!account && (
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1.5" htmlFor="acct-type">Type</label>
            <select id="acct-type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l.replace(/s$/, "")}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5" htmlFor="acct-balance">
            {type === "credit" || type === "loan" ? "Amount owed" : "Current balance"}
          </label>
          <input id="acct-balance" type="number" step="0.01" required value={balance}
            onChange={(e) => setBalance(e.target.value)} className={inputCls} placeholder="0.00" />
          <p className="text-[11px] text-ink-3 mt-1">
            {type === "credit" || type === "loan"
              ? `Enter what's owed as a positive number, e.g. ${fmtMoney(1250)}`
              : "Balance history starts from today"}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5" htmlFor="acct-inst">Institution (optional)</label>
          <input id="acct-inst" value={institution ?? ""} onChange={(e) => setInstitution(e.target.value)} className={inputCls} placeholder="e.g. First Meadow Bank" />
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          {account ? (
            <button type="button" onClick={remove} disabled={busy} className="text-sm text-neg-text hover:opacity-80">Delete account</button>
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
