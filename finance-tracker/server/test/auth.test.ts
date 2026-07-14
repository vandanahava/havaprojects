import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { freshApp, signup } from "./helpers.js";

let app: ReturnType<typeof freshApp>["app"];
let db: ReturnType<typeof freshApp>["db"];

beforeEach(() => {
  ({ app, db } = freshApp());
});

describe("auth", () => {
  it("signs up, stores a hashed password, and starts a session", async () => {
    const { agent } = await signup(app, "a@example.com");
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("a@example.com");

    const row = db.prepare("SELECT password_hash FROM users WHERE email = 'a@example.com'").get() as any;
    expect(row.password_hash).not.toContain("password123");
    expect(row.password_hash).toMatch(/^\$2[aby]\$/); // bcrypt format
  });

  it("rejects duplicate emails and weak passwords", async () => {
    await signup(app, "a@example.com");
    const dup = await supertest(app).post("/api/auth/signup").send({
      email: "a@example.com", password: "password123", name: "Dup",
    });
    expect(dup.status).toBe(409);

    const weak = await supertest(app).post("/api/auth/signup").send({
      email: "b@example.com", password: "short", name: "Weak",
    });
    expect(weak.status).toBe(400);
  });

  it("logs in with correct credentials only", async () => {
    await signup(app, "a@example.com");
    const bad = await supertest(app).post("/api/auth/login").send({
      email: "a@example.com", password: "wrong-password",
    });
    expect(bad.status).toBe(401);

    const good = await supertest(app).post("/api/auth/login").send({
      email: "a@example.com", password: "password123",
    });
    expect(good.status).toBe(200);
    expect(good.headers["set-cookie"]?.[0]).toContain("hl_session");
    expect(good.headers["set-cookie"]?.[0]).toContain("HttpOnly");
  });

  it("session persists across requests and dies on logout", async () => {
    const { agent } = await signup(app, "a@example.com");
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    await agent.post("/api/auth/logout");
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("blocks unauthenticated access to data routes", async () => {
    const anon = supertest(app);
    for (const url of [
      "/api/auth/me",
      "/api/households/1/accounts",
      "/api/households/1/transactions",
      "/api/households/1/budgets?month=2026-01",
    ]) {
      const res = await anon.get(url);
      expect(res.status, url).toBe(401);
    }
  });
});
