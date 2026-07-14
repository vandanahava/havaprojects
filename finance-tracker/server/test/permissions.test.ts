import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, signup, createHousehold, createAccount, getCategoryId, addTxn, type Agent } from "./helpers.js";

let app: ReturnType<typeof freshApp>["app"];
let owner: Agent;
let hid: number;
let accountA: number;
let accountB: number;
let groceries: number;
let txnA: number;

beforeEach(async () => {
  ({ app } = freshApp());
  ({ agent: owner } = await signup(app, "owner@example.com", "Owner"));
  hid = await createHousehold(owner);
  accountA = await createAccount(owner, hid, { name: "Account A" });
  accountB = await createAccount(owner, hid, { name: "Account B" });
  groceries = await getCategoryId(owner, hid, "Groceries");
  txnA = await addTxn(owner, hid, {
    account_id: accountA, date: "2026-07-01", amount: -50, payee: "Grocer", category_id: groceries,
  });
  await addTxn(owner, hid, { account_id: accountB, date: "2026-07-02", amount: -75, payee: "Elsewhere" });
});

async function share(body: Record<string, unknown>) {
  const res = await owner.post(`/api/households/${hid}/shares`).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("sharing defaults to private", () => {
  it("a stranger cannot see or touch anything", async () => {
    const { agent: stranger } = await signup(app, "stranger@example.com");
    expect((await stranger.get(`/api/households/${hid}`)).status).toBe(404);
    expect((await stranger.get(`/api/households/${hid}/accounts`)).status).toBe(404);
    expect((await stranger.get(`/api/households/${hid}/transactions`)).status).toBe(404);
    expect((await stranger.patch(`/api/households/${hid}/transactions/${txnA}`).send({ amount: -1 })).status).toBe(404);
    expect((await stranger.get(`/api/households/${hid}/export.json`)).status).toBe(404);
  });
});

describe("view-only household share", () => {
  let viewer: Agent;
  beforeEach(async () => {
    ({ agent: viewer } = await signup(app, "viewer@example.com", "Viewer"));
    await share({ email: "viewer@example.com", resource_type: "household", permission: "view" });
  });

  it("can read everything in the household", async () => {
    const accounts = await viewer.get(`/api/households/${hid}/accounts`);
    expect(accounts.status).toBe(200);
    expect(accounts.body.accounts).toHaveLength(2);
    const txns = await viewer.get(`/api/households/${hid}/transactions`);
    expect(txns.body.total).toBe(2);
    expect((await viewer.get(`/api/households/${hid}/networth`)).status).toBe(200);
  });

  it("cannot edit ANYTHING via direct API calls", async () => {
    const attempts: [string, () => Promise<{ status: number }>][] = [
      ["create txn", () => viewer.post(`/api/households/${hid}/transactions`).send({ account_id: accountA, date: "2026-07-03", amount: -1, payee: "hack" })],
      ["edit txn", () => viewer.patch(`/api/households/${hid}/transactions/${txnA}`).send({ amount: -999 })],
      ["delete txn", () => viewer.delete(`/api/households/${hid}/transactions/${txnA}`)],
      ["create account", () => viewer.post(`/api/households/${hid}/accounts`).send({ name: "X", type: "cash", balance: 0 })],
      ["edit account", () => viewer.patch(`/api/households/${hid}/accounts/${accountA}`).send({ balance: 0 })],
      ["delete account", () => viewer.delete(`/api/households/${hid}/accounts/${accountA}`)],
      ["set budget", () => viewer.put(`/api/households/${hid}/budgets`).send({ category_id: groceries, month: "2026-07", amount: 1 })],
      ["bulk categorize", () => viewer.post(`/api/households/${hid}/transactions/bulk-categorize`).send({ ids: [txnA], category_id: null })],
      ["set splits", () => viewer.put(`/api/households/${hid}/transactions/${txnA}/splits`).send({ splits: [] })],
      ["create goal", () => viewer.post(`/api/households/${hid}/goals`).send({ name: "G", target_amount: 1 })],
      ["create category", () => viewer.post(`/api/households/${hid}/categories`).send({ name: "Sneaky" })],
      ["rename household", () => viewer.patch(`/api/households/${hid}`).send({ name: "Taken over" })],
      ["create share", () => viewer.post(`/api/households/${hid}/shares`).send({ email: "stranger@example.com", resource_type: "household", permission: "edit" })],
      ["invite member", () => viewer.post(`/api/households/${hid}/invites`).send({ email: "friend@example.com" })],
    ];
    for (const [label, attempt] of attempts) {
      const res = await attempt();
      expect(res.status, `${label} should be denied`).toBeGreaterThanOrEqual(403);
    }
    // Nothing changed
    const txns = await owner.get(`/api/households/${hid}/transactions`);
    expect(txns.body.total).toBe(2);
    expect(txns.body.transactions.find((t: any) => t.id === txnA).amount).toBe(-50);
  });

  it("loses access immediately when the share is revoked", async () => {
    const shares = await owner.get(`/api/households/${hid}/shares`);
    const shareId = shares.body.shares[0].id;
    await owner.post(`/api/households/${hid}/shares/${shareId}/revoke`);
    expect((await viewer.get(`/api/households/${hid}/accounts`)).status).toBe(404);
  });
});

describe("edit household share", () => {
  it("can edit data but not manage members/shares/settings", async () => {
    const { agent: editor } = await signup(app, "editor@example.com", "Editor");
    await share({ email: "editor@example.com", resource_type: "household", permission: "edit" });

    const upd = await editor.patch(`/api/households/${hid}/transactions/${txnA}`).send({ amount: -60 });
    expect(upd.status).toBe(200);

    expect((await editor.patch(`/api/households/${hid}`).send({ name: "Nope" })).status).toBe(403);
    expect((await editor.post(`/api/households/${hid}/invites`).send({ email: "x@example.com" })).status).toBe(403);
    expect((await editor.post(`/api/households/${hid}/shares`).send({
      email: "someone@example.com", resource_type: "household", permission: "view",
    })).status).toBe(403);
    expect((await editor.get(`/api/households/${hid}/export.json`)).status).toBe(403);
  });
});

describe("account-scoped share", () => {
  it("sees only the shared account and its transactions", async () => {
    const { agent: guest } = await signup(app, "guest@example.com", "Guest");
    await share({ email: "guest@example.com", resource_type: "account", resource_id: accountA, permission: "view" });

    const accounts = await guest.get(`/api/households/${hid}/accounts`);
    expect(accounts.body.accounts).toHaveLength(1);
    expect(accounts.body.accounts[0].id).toBe(accountA);

    const txns = await guest.get(`/api/households/${hid}/transactions`);
    expect(txns.body.total).toBe(1);
    expect(txns.body.transactions[0].account_id).toBe(accountA);

    expect((await guest.get(`/api/households/${hid}/accounts/${accountB}`)).status).toBe(404);
    expect((await guest.get(`/api/households/${hid}/transactions?account_id=${accountB}`)).status).toBe(403);

    // Net worth only includes the shared account (1000), not B
    const nw = await guest.get(`/api/households/${hid}/networth`);
    expect(nw.body.current.net).toBe(1000);
  });

  it("edit permission is scoped to that account only", async () => {
    const { agent: guest } = await signup(app, "guest2@example.com");
    await share({ email: "guest2@example.com", resource_type: "account", resource_id: accountA, permission: "edit" });

    const ok = await guest.post(`/api/households/${hid}/transactions`).send({
      account_id: accountA, date: "2026-07-05", amount: -5, payee: "allowed",
    });
    expect(ok.status).toBe(201);

    const denied = await guest.post(`/api/households/${hid}/transactions`).send({
      account_id: accountB, date: "2026-07-05", amount: -5, payee: "denied",
    });
    expect(denied.status).toBe(403);
  });
});

describe("category-scoped share", () => {
  it("sees only that category's budget and transactions", async () => {
    const { agent: guest } = await signup(app, "catguest@example.com");
    await share({ email: "catguest@example.com", resource_type: "category", resource_id: groceries, permission: "view" });

    const txns = await guest.get(`/api/households/${hid}/transactions`);
    expect(txns.body.total).toBe(1);
    expect(txns.body.transactions[0].category_id).toBe(groceries);

    const budgets = await guest.get(`/api/households/${hid}/budgets?month=2026-07`);
    expect(budgets.body.budgets).toHaveLength(1);
    expect(budgets.body.budgets[0].category.id).toBe(groceries);

    // Cannot set the budget with view-only
    expect((await guest.put(`/api/households/${hid}/budgets`).send({
      category_id: groceries, month: "2026-07", amount: 100,
    })).status).toBe(403);
  });

  it("category edit share can set that budget but not others", async () => {
    const { agent: guest } = await signup(app, "catedit@example.com");
    await share({ email: "catedit@example.com", resource_type: "category", resource_id: groceries, permission: "edit" });
    const dining = await getCategoryId(owner, hid, "Dining Out");

    expect((await guest.put(`/api/households/${hid}/budgets`).send({
      category_id: groceries, month: "2026-07", amount: 100,
    })).status).toBe(200);
    expect((await guest.put(`/api/households/${hid}/budgets`).send({
      category_id: dining, month: "2026-07", amount: 100,
    })).status).toBe(403);
  });
});

describe("activity log", () => {
  it("records shares, edits, and revocations", async () => {
    await signup(app, "log@example.com");
    const shareId = await share({ email: "log@example.com", resource_type: "household", permission: "view" });
    await owner.post(`/api/households/${hid}/shares/${shareId}/revoke`);

    const log = await owner.get(`/api/households/${hid}/activity`);
    const actions = log.body.activity.map((a: any) => a.action);
    expect(actions).toContain("shared");
    expect(actions).toContain("revoked_share");
    expect(actions).toContain("created"); // account/txn creations
    const shared = log.body.activity.find((a: any) => a.action === "shared");
    expect(shared.user_name).toBe("Owner");
  });
});
