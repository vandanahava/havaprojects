import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  canViewAccount,
  canEditAccount,
  canEditCategory,
  txnVisibilityFilter,
  logActivity,
  type HouseholdRequest,
  type Access,
} from "../lib/permissions.js";

export const transactionsRouter = Router({ mergeParams: true });
transactionsRouter.use(requireAuth);

const txnSchema = z.object({
  account_id: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite(),
  payee: z.string().max(200).default(""),
  notes: z.string().max(1000).default(""),
  category_id: z.number().int().nullable().optional(),
  pending: z.boolean().optional(),
});

interface TxnRow {
  id: number;
  account_id: number;
  category_id: number | null;
  household_id: number;
}

function getTxn(householdId: number, id: number): TxnRow | undefined {
  return getDb()
    .prepare("SELECT id, account_id, category_id, household_id FROM transactions WHERE id = ? AND household_id = ?")
    .get(id, householdId) as TxnRow | undefined;
}

/** A user may edit a transaction if they can edit its account, or (for
 *  category-scoped shares) edit its category. */
function canEditTxn(access: Access, txn: TxnRow): boolean {
  if (canEditAccount(access, txn.account_id)) return true;
  if (txn.category_id != null && canEditCategory(access, txn.category_id)) return true;
  return false;
}

function canViewTxn(access: Access, txn: TxnRow): boolean {
  if (access.full || access.accountIds.includes(txn.account_id)) return true;
  return txn.category_id != null && access.categoryIds.includes(txn.category_id);
}

transactionsRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const db = getDb();
  const q = req.query;
  const clauses: string[] = ["t.household_id = ?"];
  const params: (string | number)[] = [req.access!.householdId];

  const vis = txnVisibilityFilter(req.access!);

  if (q.account_id) {
    const id = Number(q.account_id);
    if (!Number.isInteger(id) || !canViewAccount(req.access!, id))
      return res.status(403).json({ error: "No access to that account" });
    clauses.push("t.account_id = ?");
    params.push(id);
  }
  if (q.category_id === "none") {
    clauses.push("t.category_id IS NULL");
  } else if (q.category_id) {
    clauses.push("t.category_id = ?");
    params.push(Number(q.category_id));
  }
  if (q.search) {
    clauses.push("(t.payee LIKE ? OR t.notes LIKE ?)");
    const like = `%${String(q.search).replace(/[%_]/g, "\\$&")}%`;
    params.push(like, like);
  }
  if (q.start) { clauses.push("t.date >= ?"); params.push(String(q.start)); }
  if (q.end) { clauses.push("t.date <= ?"); params.push(String(q.end)); }
  if (q.tag) {
    clauses.push(
      "t.id IN (SELECT transaction_id FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tg.name = ? AND tg.household_id = t.household_id)"
    );
    params.push(String(q.tag));
  }

  const limit = Math.min(Number(q.limit) || 100, 500);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const where = clauses.join(" AND ") + vis.sql;
  const rows = db
    .prepare(
      `SELECT t.*, a.name as account_name, a.source as account_source, c.name as category_name, c.icon as category_icon,
        (SELECT json_group_array(json_object('id', s.id, 'category_id', s.category_id, 'amount', s.amount)) FROM transaction_splits s WHERE s.transaction_id = t.id) as splits_json,
        (SELECT json_group_array(tg.name) FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id) as tags_json
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where}
       ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, ...vis.params, limit, offset) as any[];
  const total = db
    .prepare(`SELECT COUNT(*) as n FROM transactions t WHERE ${where}`)
    .get(...params, ...vis.params) as { n: number };

  res.json({
    transactions: rows.map((r) => ({
      ...r,
      splits: JSON.parse(r.splits_json || "[]"),
      tags: JSON.parse(r.tags_json || "[]"),
      splits_json: undefined,
      tags_json: undefined,
    })),
    total: total.n,
  });
});

transactionsRouter.post("/", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const parsed = txnSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid transaction" });
  const d = parsed.data;
  const db = getDb();
  const account = db
    .prepare("SELECT id, source FROM accounts WHERE id = ? AND household_id = ?")
    .get(d.account_id, req.access!.householdId) as { id: number; source: string } | undefined;
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (!canEditAccount(req.access!, d.account_id))
    return res.status(403).json({ error: "No edit access to this account" });
  if (d.category_id != null) {
    const cat = db
      .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
      .get(d.category_id, req.access!.householdId);
    if (!cat) return res.status(400).json({ error: "Unknown category" });
  }
  const info = db
    .prepare(
      `INSERT INTO transactions (household_id, account_id, category_id, date, amount, payee, notes, pending, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.access!.householdId, d.account_id, d.category_id ?? null, d.date, d.amount,
      d.payee.trim(), d.notes.trim(), d.pending ? 1 : 0, req.user!.id
    );
  const id = Number(info.lastInsertRowid);
  logActivity(req.access!.householdId, req.user!.id, "created", "transaction", id, {
    payee: d.payee, amount: d.amount, date: d.date,
  });
  res.status(201).json({ id });
});

transactionsRouter.patch("/:txnId", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.txnId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const txn = getTxn(req.access!.householdId, id);
  if (!txn || !canViewTxn(req.access!, txn)) return res.status(404).json({ error: "Transaction not found" });
  if (!canEditTxn(req.access!, txn)) return res.status(403).json({ error: "View-only access" });
  const parsed = txnSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const d = parsed.data;
  const db = getDb();
  if (d.account_id !== undefined) {
    const acct = db
      .prepare("SELECT id FROM accounts WHERE id = ? AND household_id = ?")
      .get(d.account_id, req.access!.householdId);
    if (!acct) return res.status(400).json({ error: "Unknown account" });
    if (!canEditAccount(req.access!, d.account_id))
      return res.status(403).json({ error: "No edit access to target account" });
  }
  if (d.category_id != null) {
    const cat = db
      .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
      .get(d.category_id, req.access!.householdId);
    if (!cat) return res.status(400).json({ error: "Unknown category" });
  }
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const fields: [string, unknown][] = [
    ["account_id", d.account_id], ["date", d.date], ["amount", d.amount],
    ["payee", typeof d.payee === "string" ? d.payee.trim() : undefined],
    ["notes", typeof d.notes === "string" ? d.notes.trim() : undefined],
    ["category_id", d.category_id === undefined ? undefined : d.category_id],
    ["pending", d.pending === undefined ? undefined : d.pending ? 1 : 0],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) { sets.push(`${col} = ?`); params.push(val as string | number | null); }
  }
  if (sets.length) {
    db.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    logActivity(req.access!.householdId, req.user!.id, "updated", "transaction", id, d as Record<string, unknown>);
  }
  res.json({ ok: true });
});

transactionsRouter.delete("/:txnId", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.txnId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const txn = getTxn(req.access!.householdId, id);
  if (!txn || !canViewTxn(req.access!, txn)) return res.status(404).json({ error: "Transaction not found" });
  if (!canEditTxn(req.access!, txn)) return res.status(403).json({ error: "View-only access" });
  getDb().prepare("DELETE FROM transactions WHERE id = ?").run(id);
  logActivity(req.access!.householdId, req.user!.id, "deleted", "transaction", id);
  res.json({ ok: true });
});

transactionsRouter.post("/bulk-categorize", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const parsed = z
    .object({ ids: z.array(z.number().int()).min(1).max(500), category_id: z.number().int().nullable() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { ids, category_id } = parsed.data;
  const db = getDb();
  if (category_id != null) {
    const cat = db
      .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
      .get(category_id, req.access!.householdId);
    if (!cat) return res.status(400).json({ error: "Unknown category" });
  }
  let updated = 0;
  const run = db.transaction(() => {
    for (const id of ids) {
      const txn = getTxn(req.access!.householdId, id);
      if (!txn || !canEditTxn(req.access!, txn)) continue;
      db.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").run(category_id, id);
      updated++;
    }
  });
  run();
  logActivity(req.access!.householdId, req.user!.id, "bulk_categorized", "transaction", null, {
    count: updated, category_id,
  });
  res.json({ updated });
});

transactionsRouter.put("/:txnId/splits", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.txnId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const txn = getDb()
    .prepare("SELECT id, account_id, category_id, household_id, amount FROM transactions WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as (TxnRow & { amount: number }) | undefined;
  if (!txn || !canViewTxn(req.access!, txn)) return res.status(404).json({ error: "Transaction not found" });
  if (!canEditTxn(req.access!, txn)) return res.status(403).json({ error: "View-only access" });
  const parsed = z
    .object({
      splits: z.array(z.object({ category_id: z.number().int(), amount: z.number().finite() })).max(20),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid splits" });
  const { splits } = parsed.data;
  const db = getDb();
  if (splits.length > 0) {
    const sum = splits.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(sum - txn.amount) > 0.005)
      return res.status(400).json({ error: `Splits must sum to the transaction amount (${txn.amount})` });
    for (const s of splits) {
      const cat = db
        .prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?")
        .get(s.category_id, req.access!.householdId);
      if (!cat) return res.status(400).json({ error: "Unknown category in splits" });
    }
  }
  const run = db.transaction(() => {
    db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").run(id);
    for (const s of splits) {
      db.prepare(
        "INSERT INTO transaction_splits (transaction_id, category_id, amount) VALUES (?, ?, ?)"
      ).run(id, s.category_id, s.amount);
    }
  });
  run();
  logActivity(req.access!.householdId, req.user!.id, splits.length ? "split" : "unsplit", "transaction", id, {
    parts: splits.length,
  });
  res.json({ ok: true });
});

transactionsRouter.put("/:txnId/tags", requireHousehold("edit"), (req: HouseholdRequest, res) => {
  const id = Number(req.params.txnId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const txn = getTxn(req.access!.householdId, id);
  if (!txn || !canViewTxn(req.access!, txn)) return res.status(404).json({ error: "Transaction not found" });
  if (!canEditTxn(req.access!, txn)) return res.status(403).json({ error: "View-only access" });
  const parsed = z.object({ tags: z.array(z.string().min(1).max(50)).max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid tags" });
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM transaction_tags WHERE transaction_id = ?").run(id);
    for (const name of parsed.data.tags) {
      db.prepare("INSERT OR IGNORE INTO tags (household_id, name) VALUES (?, ?)").run(
        req.access!.householdId, name.trim().toLowerCase()
      );
      const tag = db
        .prepare("SELECT id FROM tags WHERE household_id = ? AND name = ?")
        .get(req.access!.householdId, name.trim().toLowerCase()) as { id: number };
      db.prepare("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(id, tag.id);
    }
  });
  run();
  res.json({ ok: true });
});
