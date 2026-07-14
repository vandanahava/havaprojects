import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { freshApp, signup, createHousehold, createAccount, getCategoryId, addTxn, type Agent } from "./helpers.js";
import { getDb } from "../src/lib/db.js";
import { encryptSecret } from "../src/lib/crypto.js";

let app: ReturnType<typeof freshApp>["app"];
let agent: Agent;
let hid: number;

beforeEach(async () => {
  ({ app } = freshApp());
  ({ agent } = await signup(app, "owner@example.com"));
  hid = await createHousehold(agent);
  const accountId = await createAccount(agent, hid);
  const groceries = await getCategoryId(agent, hid, "Groceries");
  await addTxn(agent, hid, {
    account_id: accountId, date: "2026-07-01", amount: -12.34, payee: 'Comma, "Quoted" Market', category_id: groceries,
  });
});

describe("data export", () => {
  it("exports full JSON without any Plaid tokens", async () => {
    getDb().prepare(
      `INSERT INTO plaid_items (household_id, item_id, access_token_encrypted, institution_name, created_by)
       VALUES (?, 'item-x', ?, 'Bank', 1)`
    ).run(hid, encryptSecret("access-sandbox-secret"));

    const res = await agent.get(`/api/households/${hid}/export.json`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.categories.length).toBeGreaterThan(10);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("access-sandbox-secret");
    expect(raw).not.toContain("access_token");
  });

  it("exports CSV with proper escaping", async () => {
    const res = await agent.get(`/api/households/${hid}/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toBe("date,payee,amount,category,account,notes,pending");
    expect(res.text).toContain('"Comma, ""Quoted"" Market"');
  });

  it("range-limited report CSV works", async () => {
    const res = await agent.get(`/api/households/${hid}/reports/export.csv?start=2026-07-01&end=2026-07-31`);
    expect(res.status).toBe(200);
    expect(res.text.split("\n")).toHaveLength(2); // header + 1 row
  });
});

describe("account deletion", () => {
  it("requires password and explicit confirmation", async () => {
    expect((await agent.post("/api/account/delete").send({ password: "password123", confirm: "yes" })).status).toBe(400);
    expect((await agent.post("/api/account/delete").send({ password: "wrong", confirm: "DELETE" })).status).toBe(401);
  });

  it("deletes the user and cascades owned households", async () => {
    const res = await agent.post("/api/account/delete").send({ password: "password123", confirm: "DELETE" });
    expect(res.status).toBe(200);

    // Session is gone
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    // Login no longer possible
    const login = await supertest(app).post("/api/auth/login").send({ email: "owner@example.com", password: "password123" });
    expect(login.status).toBe(401);
    // Data cascaded
    const db = getDb();
    expect((db.prepare("SELECT COUNT(*) n FROM households").get() as any).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM transactions").get() as any).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM accounts").get() as any).n).toBe(0);
  });
});

describe("category management", () => {
  it("merges categories moving transactions and archiving the source", async () => {
    const groceries = await getCategoryId(agent, hid, "Groceries");
    const other = await getCategoryId(agent, hid, "Other");
    const res = await agent.post(`/api/households/${hid}/categories/${groceries}/merge`).send({ target_id: other });
    expect(res.status).toBe(200);

    const txns = await agent.get(`/api/households/${hid}/transactions`);
    expect(txns.body.transactions[0].category_id).toBe(other);

    const cats = await agent.get(`/api/households/${hid}/categories?archived=1`);
    const g = cats.body.categories.find((c: any) => c.id === groceries);
    expect(g.archived).toBe(1);
  });
});
