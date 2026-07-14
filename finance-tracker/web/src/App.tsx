import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { api, type User, type Household, type Access } from "./lib/api";
import { setLocale } from "./lib/format";
import { Spinner } from "./components/ui";
import { Layout } from "./components/Layout";
import { LoginPage, SignupPage } from "./pages/Auth";
import { OnboardingPage } from "./pages/Onboarding";
import { DashboardPage } from "./pages/Dashboard";
import { AccountsPage } from "./pages/Accounts";
import { AccountDetailPage } from "./pages/AccountDetail";
import { TransactionsPage } from "./pages/Transactions";
import { BudgetsPage } from "./pages/Budgets";
import { RecurringPage } from "./pages/Recurring";
import { ReportsPage } from "./pages/Reports";
import { GoalsPage } from "./pages/Goals";
import { SharingPage } from "./pages/Sharing";
import { SettingsPage } from "./pages/Settings";

interface SessionState {
  user: User | null;
  households: Household[];
  household: Household | null;
  access: Access | null;
  loading: boolean;
  refresh: () => Promise<void>;
  selectHousehold: (id: number) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>(null!);
export const useSession = () => useContext(SessionContext);

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [householdId, setHouseholdId] = useState<number | null>(() => {
    const v = localStorage.getItem("hl_household");
    return v ? Number(v) : null;
  });
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User; households: Household[] }>("/api/auth/me");
      setUser(data.user);
      setHouseholds(data.households);
      if (data.households.length && !data.households.some((h) => h.id === householdId)) {
        setHouseholdId(data.households[0].id);
      }
    } catch {
      setUser(null);
      setHouseholds([]);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const household = useMemo(
    () => households.find((h) => h.id === householdId) ?? households[0] ?? null,
    [households, householdId]
  );

  useEffect(() => {
    if (household) {
      setLocale(household.currency, household.locale);
      localStorage.setItem("hl_household", String(household.id));
      api
        .get<{ access: Access }>(`/api/households/${household.id}`)
        .then((d) => setAccess(d.access))
        .catch(() => setAccess(null));
    } else {
      setAccess(null);
    }
  }, [household]);

  const value: SessionState = {
    user, households, household, access, loading, refresh,
    selectHousehold: (id) => setHouseholdId(id),
    logout: async () => {
      await api.post("/api/auth/logout");
      setUser(null);
      setHouseholds([]);
      localStorage.removeItem("hl_household");
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, household, loading } = useSession();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Loading HearthLedger…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!household) return <OnboardingPage />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<Protected><DashboardPage /></Protected>} />
          <Route path="/accounts" element={<Protected><AccountsPage /></Protected>} />
          <Route path="/accounts/:accountId" element={<Protected><AccountDetailPage /></Protected>} />
          <Route path="/transactions" element={<Protected><TransactionsPage /></Protected>} />
          <Route path="/budgets" element={<Protected><BudgetsPage /></Protected>} />
          <Route path="/recurring" element={<Protected><RecurringPage /></Protected>} />
          <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
          <Route path="/goals" element={<Protected><GoalsPage /></Protected>} />
          <Route path="/sharing" element={<Protected><SharingPage /></Protected>} />
          <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
