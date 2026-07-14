import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  canViewCategory,
  canEditCategory,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";

export const budgetsRouter = Router({ mergeParams: true });
budgetsRouter.use(requireAuth);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Spending for a category in a month, split-aware: a split transaction
 *  contributes its split lines instead of its own category. Spending is
 *  negative amounts; returned as a positive number. */
export function categorySpend(householdId: number, categoryId: number, month: string): number {
  const db = getDb();
  const direct = db
    .prepare(
      `SELECT COALESCE(SUM(-t.amount), 0) as s FROM transactions t
       WHERE t.household_id = ? AND t.category_id = ? AND t.amount < 0
         AND substr(t.date, 1, 7) = ?
         AND NOT EXISTS (SELECT 1 FROM transaction_splits sp WHERE sp.transaction_id = t.id)`
    )
    .get(householdId, categoryId, month) as { s: number };
  const fromSplits = db
    .prepare(
      `SELECT COALESCE(SUM(-sp.amount), 0) as s FROM transaction_splits sp
       JOIN transactions t ON t.id = sp.transaction_id
       WHERE t.household_id = ? AND sp.category_id = ? AND sp.amount < 0
         AND substr(t.date, 1, 7) = ?`
    )
    .get(householdId, categoryId, month) as { s: number };
  return Math.round((direct.s + fromSplits.s) * 100) / 100;
}

/** Effective available budget for a month. Leftover money flows forward out
 *  of a month only when THAT month's rollover flag is on, chaining through
 *  consecutive rollover months. A non-rollover month breaks the chain. */
export function effectiveBudget(householdId: number, categoryId: number, month: string): {
  amount: number;
  carry: number;
} {
  const db = getDb();
  const getRow = (m: string) =>
    db
      .prepare(
        "SELECT month, amount, rollover FROM budgets WHERE household_id = ? AND category_id = ? AND month = ?"
      )
      .get(householdId, categoryId, m) as
      | { month: string; amount: number; rollover: number }
      | undefined;

  const target = getRow(month);
  if (!target) return { amount: 0, carry: 0 };

  // Collect the run of consecutive prior months that have rollover enabled.
  const chain: { month: string; amount: number; rollover: number }[] = [];
  let cursor = prevMonth(month);
  for (let i = 0; i < 60; i++) {
    const row = getRow(cursor);
    if (!row || !row.rollover) break;
    chain.unshift(row);
    cursor = prevMonth(cursor);
  }
  let carry = 0;
  for (const b of chain) {
    const spent = categorySpend(householdId, categoryId, b.month);
    carry = Math.max(b.amount + carry - spent, 0); // overspend doesn't go negative into next month
  }
  return { amount: target.amount, carry: Math.round(carry * 100) / 100 };
}

budgetsRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const month = String(req.query.month ?? "");
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: "month=YYYY-MM required" });
  const db = getDb();
  let cats = db
    .prepare(
      "SELECT id, name, icon FROM categories WHERE household_id = ? AND archived = 0 AND is_income = 0 ORDER BY name"
    )
    .all(req.access!.householdId) as { id: number; name: string; icon: string }[];
  if (!req.access!.full) cats = cats.filter((c) => canViewCategory(req.access!, c.id));

  const rows = cats.map((c) => {
    const budget = db
      .prepare(
        "SELECT id, amount, rollover FROM budgets WHERE household_id = ? AND category_id = ? AND month = ?"
      )
      .get(req.access!.householdId, c.id, month) as
      | { id: number; amount: number; rollover: number }
      | undefined;
    const spent = categorySpend(req.access!.householdId, c.id, month);
    if (!budget) return { category: c, budget: null, spent, available: null, status: "unbudgeted" };
    const { amount, carry } = effectiveBudget(req.access!.householdId, c.id, month);
    const available = Math.round((amount + carry - spent) * 100) / 100;
    const ratio = amount + carry > 0 ? spent / (amount + carry) : spent > 0 ? 2 : 0;
    const status = ratio > 1 ? "over" : ratio > 0.85 ? "close" : "on_track";
    return {
      category: c,
      budget: { id: budget.id, amount, rollover: !!budget.rollover, carry },
      spent, available, status,
    };
  });
  res.json({ month, budgets: rows });
});

budgetsRouter.put("/", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const parsed = z
    .object({
      category_id: z.number().int(),
      month: z.string().regex(MONTH_RE),
      amount: z.number().min(0).finite(),
      rollover: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid budget" });
  const { category_id, month, amount, rollover } = parsed.data;
  const db = getDb();
  const cat = db
    .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
    .get(category_id, req.access!.householdId);
  if (!cat) return res.status(400).json({ error: "Unknown category" });
  if (!canEditCategory(req.access!, category_id))
    return res.status(403).json({ error: "No edit access to this category" });
  db.prepare(
    `INSERT INTO budgets (household_id, category_id, month, amount, rollover)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(household_id, category_id, month)
     DO UPDATE SET amount = excluded.amount, rollover = excluded.rollover`
  ).run(req.access!.householdId, category_id, month, amount, rollover ? 1 : 0);
  logActivity(req.access!.householdId, req.user!.id, "set_budget", "budget", category_id, {
    month, amount, rollover: !!rollover,
  });
  res.json({ ok: true });
});

budgetsRouter.delete("/:budgetId", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.budgetId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const db = getDb();
  const row = db
    .prepare("SELECT id, category_id, month FROM budgets WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as { id: number; category_id: number; month: string } | undefined;
  if (!row) return res.status(404).json({ error: "Budget not found" });
  if (!canEditCategory(req.access!, row.category_id))
    return res.status(403).json({ error: "No edit access to this category" });
  db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
  logActivity(req.access!.householdId, req.user!.id, "deleted", "budget", row.category_id, { month: row.month });
  res.json({ ok: true });
});

// Budget vs actual across recent months (for the performance view)
budgetsRouter.get("/history", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
  const now = new Date();
  const out: { month: string; budgeted: number; spent: number }[] = [];
  const db = getDb();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const budgeted = db
      .prepare("SELECT COALESCE(SUM(amount), 0) as s FROM budgets WHERE household_id = ? AND month = ?")
      .get(req.access!.householdId, month) as { s: number };
    const catIds = db
      .prepare("SELECT DISTINCT category_id FROM budgets WHERE household_id = ? AND month = ?")
      .all(req.access!.householdId, month) as { category_id: number }[];
    let spent = 0;
    for (const c of catIds) spent += categorySpend(req.access!.householdId, c.category_id, month);
    out.push({ month, budgeted: budgeted.s, spent: Math.round(spent * 100) / 100 });
  }
  res.json({ history: out });
});
