import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../App";
import { useFetch } from "../lib/useFetch";
import { api, type Category } from "../lib/api";
import { PageHeader } from "../components/Layout";
import { Card, CardHeader, Spinner, ErrorState, Modal, inputCls, btnPrimary, btnGhost, btnDanger, Badge } from "../components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "CHF"];
const LOCALES = ["en-US", "en-GB", "de-DE", "fr-FR", "es-ES", "ja-JP", "en-IN", "en-CA"];

export function SettingsPage() {
  const { household, access, refresh, logout } = useSession();
  const hid = household!.id;
  const isOwner = access?.role === "owner";
  const isMember = access?.role !== "guest";
  const navigate = useNavigate();

  const categories = useFetch<{ categories: Category[] }>(`/api/households/${hid}/categories?archived=1`);
  const [name, setName] = useState(household!.name);
  const [currency, setCurrency] = useState(household!.currency);
  const [locale, setLocale] = useState(household!.locale);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("📁");
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [merging, setMerging] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function saveHousehold(e: FormEvent) {
    e.preventDefault();
    setSaveMsg(null);
    try {
      await api.patch(`/api/households/${hid}`, { name, currency, locale });
      await refresh();
      setSaveMsg("Saved ✓");
    } catch (err) {
      setSaveMsg((err as Error).message);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    await api.post(`/api/households/${hid}/categories`, { name: newCat, icon: newCatIcon });
    setNewCat("");
    categories.reload();
  }

  async function archiveCategory(c: Category) {
    await api.patch(`/api/households/${hid}/categories/${c.id}`, { archived: !c.archived });
    categories.reload();
  }

  const active = (categories.data?.categories ?? []).filter((c) => !c.archived);
  const archived = (categories.data?.categories ?? []).filter((c) => c.archived);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Household settings */}
          <Card>
            <CardHeader title="Household" sub={isOwner ? "Name, currency and locale" : "Only the owner can change these"} />
            <form onSubmit={saveHousehold} className="px-5 pb-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1.5">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1.5">Currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!isOwner} className={inputCls}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1.5">Locale</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)} disabled={!isOwner} className={inputCls}>
                    {LOCALES.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              {isOwner && (
                <div className="flex items-center gap-3">
                  <button type="submit" className={btnPrimary}>Save</button>
                  {saveMsg && <span className="text-sm text-ink-2">{saveMsg}</span>}
                </div>
              )}
            </form>
          </Card>

          {/* Data export */}
          {isMember && (
            <Card>
              <CardHeader title="Your data" sub="Export everything, any time" />
              <div className="px-5 pb-5 flex flex-wrap gap-2">
                <a href={`/api/households/${hid}/export.json`} className={btnGhost} download>⬇ Full JSON export</a>
                <a href={`/api/households/${hid}/export.csv`} className={btnGhost} download>⬇ Transactions CSV</a>
              </div>
            </Card>
          )}

          {/* Danger zone */}
          <Card className="border-neg/25">
            <CardHeader title="Delete my account" sub="Removes your login and every household you own — permanently" />
            <div className="px-5 pb-5">
              <button onClick={() => setDeleting(true)} className={btnDanger}>Delete account…</button>
            </div>
          </Card>
        </div>

        {/* Categories */}
        <Card className="h-fit">
          <CardHeader title="Categories" sub="Create, rename, merge, or archive" />
          <div className="px-5 pb-5">
            {!isMember ? (
              <p className="text-sm text-ink-3">Shared guests can’t manage categories.</p>
            ) : categories.loading && !categories.data ? <Spinner /> :
             categories.error ? <ErrorState message={categories.error} retry={categories.reload} /> : (
              <>
                <form onSubmit={addCategory} className="flex gap-2 mb-4">
                  <input value={newCatIcon} onChange={(e) => setNewCatIcon(e.target.value)} className={`${inputCls} !w-16 text-center`} maxLength={4} aria-label="Icon" />
                  <input value={newCat} onChange={(e) => setNewCat(e.target.value)} className={inputCls} placeholder="New category name…" aria-label="New category name" />
                  <button type="submit" className={btnPrimary}>Add</button>
                </form>
                <ul className="divide-y divide-hairline">
                  {active.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                      <span className="flex items-center gap-2">
                        <span aria-hidden>{c.icon}</span>{c.name}
                        {!!c.is_income && <Badge tone="green">income</Badge>}
                      </span>
                      <span className="flex gap-3 text-xs">
                        <button onClick={() => setRenaming(c)} className="text-accent hover:text-accent-deep">Rename</button>
                        <button onClick={() => setMerging(c)} className="text-ink-3 hover:text-ink">Merge</button>
                        <button onClick={() => archiveCategory(c)} className="text-ink-3 hover:text-neg-text">Archive</button>
                      </span>
                    </li>
                  ))}
                </ul>
                {archived.length > 0 && (
                  <details className="mt-4">
                    <summary className="text-xs text-ink-3 cursor-pointer">Archived ({archived.length})</summary>
                    <ul className="divide-y divide-hairline mt-2">
                      {archived.map((c) => (
                        <li key={c.id} className="flex items-center justify-between py-2 text-sm text-ink-3">
                          <span>{c.icon} {c.name}</span>
                          <button onClick={() => archiveCategory(c)} className="text-xs text-accent">Restore</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {renaming && (
        <RenameModal cat={renaming} householdId={hid}
          onClose={() => setRenaming(null)}
          onSaved={() => { setRenaming(null); categories.reload(); }} />
      )}
      {merging && (
        <MergeModal cat={merging} all={active} householdId={hid}
          onClose={() => setMerging(null)}
          onSaved={() => { setMerging(null); categories.reload(); }} />
      )}
      {deleting && (
        <DeleteAccountModal onClose={() => setDeleting(false)} onDeleted={async () => { await logout(); navigate("/login"); }} />
      )}
    </>
  );
}

function RenameModal({ cat, householdId, onClose, onSaved }: {
  cat: Category; householdId: number; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(cat.name);
  const [icon, setIcon] = useState(cat.icon);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await api.patch(`/api/households/${householdId}/categories/${cat.id}`, { name, icon });
    onSaved();
  }
  return (
    <Modal title="Rename category" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[64px_1fr] gap-3">
          <input value={icon} onChange={(e) => setIcon(e.target.value)} className={`${inputCls} text-center`} maxLength={4} aria-label="Icon" />
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="Name" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function MergeModal({ cat, all, householdId, onClose, onSaved }: {
  cat: Category; all: Category[]; householdId: number; onClose: () => void; onSaved: () => void;
}) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/households/${householdId}/categories/${cat.id}/merge`, { target_id: Number(target) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title={`Merge “${cat.name}” into…`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-2">
          All transactions, splits, and history move to the target category. “{cat.name}” is archived.
        </p>
        <select required value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls} aria-label="Merge target">
          <option value="" disabled>Choose target category…</option>
          {all.filter((c) => c.id !== cat.id && c.is_income === cat.is_income).map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>
        {error && <p className="text-sm text-neg-text">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" className={btnPrimary}>Merge</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteAccountModal({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/account/delete", { password, confirm: confirmText });
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete account — are you sure?" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-2">
          This permanently deletes your login and <strong>every household you own</strong>, including
          all accounts, transactions, and budgets. Consider exporting your data first. This cannot be undone.
        </p>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Your password</label>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="current-password" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1.5">Type <code className="bg-page px-1 rounded">DELETE</code> to confirm</label>
          <input required value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputCls} placeholder="DELETE" />
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy || confirmText !== "DELETE"} className={btnDanger}>
            {busy ? "Deleting…" : "Permanently delete"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
