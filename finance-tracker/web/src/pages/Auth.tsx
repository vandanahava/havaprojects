import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../App";
import { inputCls, btnPrimary } from "../components/ui";

function AuthShell({ children, title, sub }: { children: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-accent to-accent-deep grid place-items-center text-white text-xl font-bold shadow">
            H
          </div>
          <span className="text-white text-xl font-semibold">HearthLedger</span>
        </div>
        <div className="bg-card rounded-2xl shadow-(--shadow-pop) p-7">
          <h1 className="text-xl font-semibold text-center">{title}</h1>
          <p className="text-sm text-ink-3 text-center mt-1 mb-6">{sub}</p>
          {children}
        </div>
        <p className="text-center text-white/30 text-xs mt-6">
          Track spending, budgets & net worth — together.
        </p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      await refresh();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" sub="Sign in to your household">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-ink-2 mb-1.5">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className={inputCls} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-ink-2 mb-1.5">Password</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className={inputCls} placeholder="••••••••" autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-sm text-ink-3 text-center mt-5">
        New here?{" "}
        <Link to="/signup" className="text-accent font-medium hover:text-accent-deep">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/signup", { name, email, password });
      await refresh();
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your account" sub="Free, private, and shareable when you choose">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-ink-2 mb-1.5">Your name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)}
            className={inputCls} placeholder="Avery Juniper" autoComplete="name" />
        </div>
        <div>
          <label htmlFor="email" className="block text-xs font-medium text-ink-2 mb-1.5">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className={inputCls} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-ink-2 mb-1.5">Password</label>
          <input id="password" type="password" required minLength={8} value={password}
            onChange={(e) => setPassword(e.target.value)} className={inputCls}
            placeholder="At least 8 characters" autoComplete="new-password" />
        </div>
        {error && <p className="text-sm text-neg-text bg-neg/10 rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="text-sm text-ink-3 text-center mt-5">
        Already have an account?{" "}
        <Link to="/login" className="text-accent font-medium hover:text-accent-deep">Sign in</Link>
      </p>
    </AuthShell>
  );
}
