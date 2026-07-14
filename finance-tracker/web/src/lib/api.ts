export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, (isJson && (data as any).error) || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

// ── Shared types ─────────────────────────────────────────────────────────
export interface User { id: number; email: string; name: string }
export interface Household { id: number; name: string; currency: string; locale: string; role: string }
export interface Access {
  role: "owner" | "member" | "guest";
  permission: "edit" | "view";
  full: boolean;
  accountIds: number[];
  categoryIds: number[];
  editableAccountIds: number[] | "all";
  editableCategoryIds: number[] | "all";
}
export interface Account {
  id: number; name: string; type: string; source: "manual" | "plaid";
  institution_name: string | null; current_balance: number; currency: string;
  archived: number; is_liability: boolean; plaid_status?: string | null; plaid_item_id?: number | null;
}
export interface Category { id: number; name: string; icon: string; is_income: number; archived: number }
export interface Txn {
  id: number; account_id: number; category_id: number | null; date: string; amount: number;
  payee: string; notes: string; pending: number; account_name: string; account_source: string;
  category_name: string | null; category_icon: string | null;
  splits: { id: number; category_id: number; amount: number }[];
  tags: string[];
}
export interface BudgetRow {
  category: { id: number; name: string; icon: string };
  budget: { id: number; amount: number; rollover: boolean; carry: number } | null;
  spent: number;
  available: number | null;
  status: "on_track" | "close" | "over" | "unbudgeted";
}
export interface Goal {
  id: number; name: string; icon: string; target_amount: number;
  target_date: string | null; saved_amount: number;
}
export interface NetWorthPoint { date: string; assets: number; liabilities: number; net: number }
