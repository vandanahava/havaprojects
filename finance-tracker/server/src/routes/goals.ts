import { Router } from "express";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  requireHousehold,
  requireMember,
  logActivity,
  type HouseholdRequest,
} from "../lib/permissions.js";

export const goalsRouter = Router({ mergeParams: true });
goalsRouter.use(requireAuth);

goalsRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const goals = getDb()
    .prepare("SELECT * FROM goals WHERE household_id = ? ORDER BY created_at")
    .all(req.access!.householdId);
  res.json({ goals });
});

const goalSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  target_amount: z.number().positive().finite(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  saved_amount: z.number().min(0).finite().optional(),
});

goalsRouter.post("/", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid goal" });
  const d = parsed.data;
  const info = getDb()
    .prepare(
      "INSERT INTO goals (household_id, name, icon, target_amount, target_date, saved_amount) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(req.access!.householdId, d.name.trim(), d.icon ?? "🎯", d.target_amount, d.target_date ?? null, d.saved_amount ?? 0);
  logActivity(req.access!.householdId, req.user!.id, "created", "goal", Number(info.lastInsertRowid), { name: d.name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

goalsRouter.patch("/:goalId", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const id = Number(req.params.goalId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const parsed = goalSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" });
  const db = getDb();
  const goal = db.prepare("SELECT id FROM goals WHERE id = ? AND household_id = ?").get(id, req.access!.householdId);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const d = parsed.data;
  if (d.name) db.prepare("UPDATE goals SET name = ? WHERE id = ?").run(d.name.trim(), id);
  if (d.icon) db.prepare("UPDATE goals SET icon = ? WHERE id = ?").run(d.icon, id);
  if (d.target_amount !== undefined) db.prepare("UPDATE goals SET target_amount = ? WHERE id = ?").run(d.target_amount, id);
  if (d.target_date !== undefined) db.prepare("UPDATE goals SET target_date = ? WHERE id = ?").run(d.target_date, id);
  if (d.saved_amount !== undefined) db.prepare("UPDATE goals SET saved_amount = ? WHERE id = ?").run(d.saved_amount, id);
  logActivity(req.access!.householdId, req.user!.id, "updated", "goal", id, d as Record<string, unknown>);
  res.json({ ok: true });
});

goalsRouter.post("/:goalId/contribute", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const id = Number(req.params.goalId);
  const parsed = z.object({ amount: z.number().finite() }).safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) return res.status(400).json({ error: "Bad request" });
  const db = getDb();
  const goal = db
    .prepare("SELECT id, saved_amount FROM goals WHERE id = ? AND household_id = ?")
    .get(id, req.access!.householdId) as { id: number; saved_amount: number } | undefined;
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const next = Math.max(goal.saved_amount + parsed.data.amount, 0);
  db.prepare("UPDATE goals SET saved_amount = ? WHERE id = ?").run(next, id);
  logActivity(req.access!.householdId, req.user!.id, "contributed", "goal", id, { amount: parsed.data.amount });
  res.json({ saved_amount: next });
});

goalsRouter.delete("/:goalId", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const id = Number(req.params.goalId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  const info = getDb()
    .prepare("DELETE FROM goals WHERE id = ? AND household_id = ?")
    .run(id, req.access!.householdId);
  if (info.changes === 0) return res.status(404).json({ error: "Goal not found" });
  logActivity(req.access!.householdId, req.user!.id, "deleted", "goal", id);
  res.json({ ok: true });
});
