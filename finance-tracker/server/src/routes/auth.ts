import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import {
  createSession,
  destroySession,
  setSessionCookie,
  requireAuth,
  SESSION_COOKIE,
  type AuthedRequest,
} from "../lib/auth.js";

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: z.string().min(1).max(100),
});

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  const { email, password, name } = parsed.data;
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "An account with that email already exists" });
  const hash = await bcrypt.hash(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)")
    .run(email, hash, name.trim());
  const userId = Number(info.lastInsertRowid);

  // Auto-accept any pending invites for this email
  const invites = db
    .prepare("SELECT id, household_id FROM invites WHERE email = ? AND status = 'pending'")
    .all(email) as { id: number; household_id: number }[];
  for (const inv of invites) {
    db.prepare(
      "INSERT OR IGNORE INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')"
    ).run(inv.household_id, userId);
    db.prepare("UPDATE invites SET status = 'accepted' WHERE id = ?").run(inv.id);
  }

  const token = createSession(userId);
  setSessionCookie(res, token);
  res.status(201).json({ user: { id: userId, email, name: name.trim() } });
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid email or password" });
  const { email, password } = parsed.data;
  const row = getDb()
    .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
    .get(email) as { id: number; email: string; name: string; password_hash: string } | undefined;
  const ok = row && (await bcrypt.compare(password, row.password_hash));
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  const token = createSession(row.id);
  setSessionCookie(res, token);
  res.json({ user: { id: row.id, email: row.email, name: row.name } });
});

authRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) destroySession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const households = getDb()
    .prepare(
      `SELECT h.id, h.name, h.currency, h.locale, hm.role FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE hm.user_id = ?
       UNION
       SELECT DISTINCT h.id, h.name, h.currency, h.locale, 'guest' as role FROM households h
       JOIN shares s ON s.household_id = h.id
       WHERE s.grantee_user_id = ? AND s.revoked_at IS NULL
         AND h.id NOT IN (SELECT household_id FROM household_members WHERE user_id = ?)`
    )
    .all(req.user!.id, req.user!.id, req.user!.id);
  res.json({ user: req.user, households });
});
