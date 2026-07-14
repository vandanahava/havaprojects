import { describe, it, expect, beforeEach } from "vitest";
import { computeNetWorthSeries } from "../src/routes/networth.js";
import { freshApp, signup, createHousehold, createAccount, type Agent } from "./helpers.js";

describe("computeNetWorthSeries (unit)", () => {
  const accounts = [
    { id: 1, type: "checking" },
    { id: 2, type: "credit" },
    { id: 3, type: "investment" },
  ];

  it("subtracts liabilities and carries balances forward", () => {
    const snapshots = [
      { account_id: 1, date: "2026-01-01", balance: 1000 },
      { account_id: 2, date: "2026-01-01", balance: 400 }, // owed
      { account_id: 3, date: "2026-01-05", balance: 5000 },
      { account_id: 1, date: "2026-01-10", balance: 1200 },
    ];
    const series = computeNetWorthSeries(accounts, snapshots, ["2026-01-01", "2026-01-06", "2026-01-12"]);
    expect(series[0]).toEqual({ date: "2026-01-01", assets: 1000, liabilities: 400, net: 600 });
    // Jan 6: investment appeared, checking carried forward
    expect(series[1]).toEqual({ date: "2026-01-06", assets: 6000, liabilities: 400, net: 5600 });
    // Jan 12: checking updated
    expect(series[2]).toEqual({ date: "2026-01-12", assets: 6200, liabilities: 400, net: 5800 });
  });

  it("ignores accounts with no snapshots yet and handles negative liability entries", () => {
    const snapshots = [
      { account_id: 1, date: "2026-01-02", balance: 100 },
      { account_id: 2, date: "2026-01-02", balance: -250 }, // some sources store owed as negative
    ];
    const series = computeNetWorthSeries(accounts, snapshots, ["2026-01-01", "2026-01-03"]);
    expect(series[0].net).toBe(0); // nothing known yet
    expect(series[1]).toEqual({ date: "2026-01-03", assets: 100, liabilities: 250, net: -150 });
  });
});

describe("net worth endpoint (integration)", () => {
  let app: ReturnType<typeof freshApp>["app"];
  let agent: Agent;
  let hid: number;

  beforeEach(async () => {
    ({ app } = freshApp());
    ({ agent } = await signup(app, "nw@example.com"));
    hid = await createHousehold(agent);
  });

  it("combines manual asset and liability accounts", async () => {
    await createAccount(agent, hid, { name: "Checking", type: "checking", balance: 5000 });
    await createAccount(agent, hid, { name: "Card", type: "credit", balance: 1200 });
    await createAccount(agent, hid, { name: "House", type: "property", balance: 300000 });
    await createAccount(agent, hid, { name: "Mortgage", type: "loan", balance: 200000 });

    const res = await agent.get(`/api/households/${hid}/networth?days=7`);
    expect(res.status).toBe(200);
    expect(res.body.current.assets).toBe(305000);
    expect(res.body.current.liabilities).toBe(201200);
    expect(res.body.current.net).toBe(103800);
  });

  it("reflects balance updates in the series", async () => {
    const id = await createAccount(agent, hid, { name: "Checking", type: "checking", balance: 1000 });
    await agent.patch(`/api/households/${hid}/accounts/${id}`).send({ balance: 1500 });
    const res = await agent.get(`/api/households/${hid}/networth?days=7`);
    expect(res.body.current.net).toBe(1500);
  });
});
