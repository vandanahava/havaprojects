import { Router } from "express";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { requireHousehold, txnVisibilityFilter, type HouseholdRequest } from "../lib/permissions.js";

export const reportsRouter = Router({ mergeParams: true });
reportsRouter.use(requireAuth);

function dateRange(req: HouseholdRequest): { start: string; end: string } {
  const end = typeof req.query.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.end)
    ? req.query.end
    : new Date().toISOString().slice(0, 10);
  const defStart = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const start = typeof req.query.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.start)
    ? req.query.start
    : defStart;
  return { start, end };
}

/** Spending grouped by category (split-aware). */
reportsRouter.get("/spending", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const { start, end } = dateRange(req);
  const vis = txnVisibilityFilter(req.access!);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.icon, SUM(x.spend) as total FROM (
         SELECT t.category_id as cid, -t.amount as spend FROM transactions t
         WHERE t.household_id = ? AND t.amount < 0 AND t.date >= ? AND t.date <= ? ${vis.sql}
           AND NOT EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = t.id)
         UNION ALL
         SELECT sp.category_id as cid, -sp.amount as spend FROM transaction_splits sp
         JOIN transactions t ON t.id = sp.transaction_id
         WHERE t.household_id = ? AND sp.amount < 0 AND t.date >= ? AND t.date <= ? ${vis.sql}
       ) x LEFT JOIN categories c ON c.id = x.cid
       GROUP BY c.id ORDER BY total DESC`
    )
    .all(
      req.access!.householdId, start, end, ...vis.params,
      req.access!.householdId, start, end, ...vis.params
    ) as { id: number | null; name: string | null; icon: string | null; total: number }[];
  res.json({
    start, end,
    categories: rows.map((r) => ({
      id: r.id, name: r.name ?? "Uncategorized", icon: r.icon ?? "❔",
      total: Math.round(r.total * 100) / 100,
    })),
  });
});

/** Income vs expense per month. */
reportsRouter.get("/cashflow", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const { start, end } = dateRange(req);
  const vis = txnVisibilityFilter(req.access!);
  const rows = getDb()
    .prepare(
      `SELECT substr(t.date, 1, 7) as month,
              COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0) as income,
              COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount END), 0) as expense
       FROM transactions t WHERE t.household_id = ? AND t.date >= ? AND t.date <= ? ${vis.sql}
       GROUP BY month ORDER BY month`
    )
    .all(req.access!.householdId, start, end, ...vis.params) as {
    month: string; income: number; expense: number;
  }[];
  res.json({
    start, end,
    months: rows.map((r) => ({
      month: r.month,
      income: Math.round(r.income * 100) / 100,
      expense: Math.round(r.expense * 100) / 100,
      net: Math.round((r.income - r.expense) * 100) / 100,
    })),
  });
});

/** Per-day net flow for the cash flow calendar. */
reportsRouter.get("/calendar", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const month = String(req.query.month ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM required" });
  const vis = txnVisibilityFilter(req.access!);
  const rows = getDb()
    .prepare(
      `SELECT t.date, COALESCE(SUM(t.amount), 0) as net, COUNT(*) as count
       FROM transactions t WHERE t.household_id = ? AND substr(t.date, 1, 7) = ? ${vis.sql}
       GROUP BY t.date ORDER BY t.date`
    )
    .all(req.access!.householdId, month, ...vis.params) as { date: string; net: number; count: number }[];
  res.json({ month, days: rows.map((r) => ({ ...r, net: Math.round(r.net * 100) / 100 })) });
});

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export of transactions for a date range. */
reportsRouter.get("/export.csv", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const { start, end } = dateRange(req);
  const vis = txnVisibilityFilter(req.access!);
  const rows = getDb()
    .prepare(
      `SELECT t.date, t.payee, t.amount, t.notes, a.name as account, c.name as category
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ? AND t.date >= ? AND t.date <= ? ${vis.sql}
       ORDER BY t.date DESC`
    )
    .all(req.access!.householdId, start, end, ...vis.params) as any[];
  const header = "date,payee,amount,category,account,notes";
  const lines = rows.map((r) =>
    [r.date, r.payee, r.amount, r.category ?? "", r.account, r.notes].map(csvEscape).join(",")
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="transactions-${start}-to-${end}.csv"`);
  res.send([header, ...lines].join("\n"));
});
