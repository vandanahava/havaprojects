import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useSession } from "../App";
import { inputCls, btnPrimary } from "../components/ui";

export function OnboardingPage() {
  const { user, refresh, logout } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/households", { name });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-(--shadow-pop) p-7">
        <div className="text-3xl mb-2">🏡</div>
        <h1 className="text-xl font-semibold">Welcome, {user?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-ink-3 mt-1 mb-6">
          Create your household to get started. You can invite a partner, roommate, or family
          later — everything stays private until you share it.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="hh-name" className="block text-xs font-medium text-ink-2 mb-1.5">Household name</label>
            <input id="hh-name" required value={name} onChange={(e) => setName(e.target.value)}
              className={inputCls} placeholder="e.g. Juniper Lane" />
          </div>
          {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
            {busy ? "Creating…" : "Create household"}
          </button>
        </form>
        <button onClick={logout} className="mt-4 w-full text-center text-xs text-ink-3 hover:text-ink">
          Sign out
        </button>
      </div>
    </div>
  );
}
