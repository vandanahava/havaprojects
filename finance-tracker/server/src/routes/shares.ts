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

export const sharesRouter = Router({ mergeParams: true });
sharesRouter.use(requireAuth);

const shareSchema = z.object({
  email: z.string().email().max(200),
  resource_type: z.enum(["household", "account", "category"]),
  resource_id: z.number().int().nullable().optional(),
  permission: z.enum(["view", "edit"]),
});

sharesRouter.get("/", requireHousehold("view"), requireMember, (req: HouseholdRequest, res) => {
  const shares = getDb()
    .prepare(
      `SELECT s.id, s.resource_type, s.resource_id, s.permission, s.created_at, s.revoked_at,
              u.email as grantee_email, u.name as grantee_name,
              CASE s.resource_type
                WHEN 'account' THEN (SELECT name FROM accounts WHERE id = s.resource_id)
                WHEN 'category' THEN (SELECT name FROM categories WHERE id = s.resource_id)
                ELSE NULL END as resource_name
       FROM shares s JOIN users u ON u.id = s.grantee_user_id
       WHERE s.household_id = ? ORDER BY s.created_at DESC`
    )
    .all(req.access!.householdId);
  res.json({ shares });
});

sharesRouter.post("/", requireHousehold("edit"), requireMember, (req: HouseholdRequest, res) => {
  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid share" });
  const { email, resource_type, resource_id, permission } = parsed.data;
  const db = getDb();
  const grantee = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as
    | { id: number }
    | undefined;
  if (!grantee)
    return res.status(404).json({
      error: "No user with that email. Ask them to sign up first, then share.",
    });
  if (grantee.id === req.user!.id) return res.status(400).json({ error: "You already have access" });
  const isMember = db
    .prepare("SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?")
    .get(req.access!.householdId, grantee.id);
  if (isMember) return res.status(400).json({ error: "That person is already a household member" });

  if (resource_type === "household") {
    if (resource_id != null) return res.status(400).json({ error: "Household shares take no resource id" });
  } else {
    if (resource_id == null) return res.status(400).json({ error: "resource_id required" });
    const table = resource_type === "account" ? "accounts" : "categories";
    const exists = db
      .prepare(`SELECT id FROM ${table} WHERE id = ? AND household_id = ?`)
      .get(resource_id, req.access!.householdId);
    if (!exists) return res.status(404).json({ error: `${resource_type} not found` });
  }

  const info = db
    .prepare(
      `INSERT INTO shares (household_id, resource_type, resource_id, grantee_user_id, permission, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.access!.householdId, resource_type, resource_id ?? null, grantee.id, permission, req.user!.id);
  logActivity(req.access!.householdId, req.user!.id, "shared", resource_type, resource_id ?? null, {
    with: email, permission,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

sharesRouter.post(
  "/:shareId/revoke",
  requireHousehold("edit"),
  requireMember,
  (req: HouseholdRequest, res) => {
    const id = Number(req.params.shareId);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
    const db = getDb();
    const share = db
      .prepare("SELECT id, resource_type, resource_id, grantee_user_id FROM shares WHERE id = ? AND household_id = ? AND revoked_at IS NULL")
      .get(id, req.access!.householdId) as
      | { id: number; resource_type: string; resource_id: number | null; grantee_user_id: number }
      | undefined;
    if (!share) return res.status(404).json({ error: "Share not found" });
    db.prepare("UPDATE shares SET revoked_at = datetime('now') WHERE id = ?").run(id);
    logActivity(req.access!.householdId, req.user!.id, "revoked_share", share.resource_type, share.resource_id, {
      grantee_user_id: share.grantee_user_id,
    });
    res.json({ ok: true });
  }
);

// ── Activity log ────────────────────────────────────────────────────────
export const activityRouter = Router({ mergeParams: true });
activityRouter.use(requireAuth);

activityRouter.get("/", requireHousehold("view"), (req: HouseholdRequest, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = getDb()
    .prepare(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              u.name as user_name, u.email as user_email
       FROM activity_log al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.household_id = ? ORDER BY al.id DESC LIMIT ?`
    )
    .all(req.access!.householdId, limit) as any[];
  res.json({ activity: rows.map((r) => ({ ...r, details: JSON.parse(r.details || "{}") })) });
});
