import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useSession } from "../App";
import { Badge } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "◈" },
  { to: "/accounts", label: "Accounts", icon: "🏦" },
  { to: "/transactions", label: "Transactions", icon: "⇄" },
  { to: "/budgets", label: "Budgets", icon: "◔" },
  { to: "/recurring", label: "Recurring", icon: "↻" },
  { to: "/reports", label: "Reports", icon: "▤" },
  { to: "/goals", label: "Goals", icon: "◎" },
  { to: "/sharing", label: "Sharing", icon: "⚭" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
              isActive
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`
          }
        >
          <span className="w-5 text-center opacity-80" aria-hidden>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, household, households, access, selectHousehold, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const title = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)))?.label ?? "HearthLedger";

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-accent-deep grid place-items-center text-white text-lg font-bold shadow">
            H
          </div>
          <div>
            <div className="text-white font-semibold leading-tight">HearthLedger</div>
            <div className="text-[11px] text-white/40">household finance</div>
          </div>
        </div>
      </div>
      <div className="px-6 pb-4">
        <label className="sr-only" htmlFor="household-select">Household</label>
        <select
          id="household-select"
          value={household?.id}
          onChange={(e) => selectHousehold(Number(e.target.value))}
          className="w-full rounded-lg bg-white/10 text-white text-sm px-3 py-2 border border-white/10 focus:outline-none focus:ring-2 focus:ring-accent/60"
        >
          {households.map((h) => (
            <option key={h.id} value={h.id} className="text-ink">
              {h.name}{h.role === "guest" ? " (shared with you)" : ""}
            </option>
          ))}
        </select>
        {access?.role === "guest" && (
          <div className="mt-2">
            <Badge tone="amber">{access.permission === "view" ? "View only" : "Can edit"} · shared</Badge>
          </div>
        )}
      </div>
      <NavItems onNavigate={() => setMenuOpen(false)} />
      <div className="mt-auto px-6 py-5 border-t border-white/10">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm text-white truncate">{user?.name}</div>
            <div className="text-[11px] text-white/40 truncate">{user?.email}</div>
          </div>
          <button
            onClick={logout}
            className="text-xs text-white/50 hover:text-white border border-white/15 rounded-lg px-2.5 py-1.5 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-navy-900">{sidebar}</aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between bg-navy-900 px-4 py-3">
        <div className="flex items-center gap-2 text-white font-semibold">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-accent-deep grid place-items-center text-sm font-bold">H</div>
          {title}
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          className="text-white/80 text-xl px-2"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </header>
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-navy-900 pt-16 overflow-y-auto">{sidebar}</div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-ink-3 mt-1">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
