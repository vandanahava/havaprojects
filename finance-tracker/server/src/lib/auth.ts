import type { Request, Response, NextFunction } from "express";
import { getDb } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "hl_session";
const SESSION_DAYS = 30;

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; name: string };
}

export function createSession(userId: number): string {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(userId, sha256(token), expires);
  return token;
}

export function destroySession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400_000,
    path: "/",
  });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.name FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .get(sha256(token)) as { id: number; email: string; name: string } | undefined;
  if (!row) return res.status(401).json({ error: "Session expired" });
  req.user = row;
  next();
}
