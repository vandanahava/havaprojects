import supertest from "supertest";
import { createDb, setDb } from "../src/lib/db.js";
import { createApp } from "../src/app.js";

process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY?.length === 64
    ? process.env.TOKEN_ENCRYPTION_KEY
    : "a".repeat(64);

export function freshApp() {
  const db = createDb(":memory:");
  setDb(db);
  return { app: createApp(), db };
}

export type Agent = ReturnType<typeof supertest.agent>;

export async function signup(app: ReturnType<typeof createApp>, email: string, name = "Test User") {
  const agent = supertest.agent(app);
  const res = await agent.post("/api/auth/signup").send({ email, password: "password123", name });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, userId: res.body.user.id as number };
}

export async function createHousehold(agent: Agent, name = "Test House") {
  const res = await agent.post("/api/households").send({ name });
  if (res.status !== 201) throw new Error(`household failed: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

export async function createAccount(agent: Agent, hid: number, over: Record<string, unknown> = {}) {
  const res = await agent.post(`/api/households/${hid}/accounts`).send({
    name: "Checking", type: "checking", balance: 1000, ...over,
  });
  if (res.status !== 201) throw new Error(`account failed: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

export async function getCategoryId(agent: Agent, hid: number, name: string) {
  const res = await agent.get(`/api/households/${hid}/categories`);
  const cat = res.body.categories.find((c: { name: string }) => c.name === name);
  if (!cat) throw new Error(`category ${name} not found`);
  return cat.id as number;
}

export async function addTxn(agent: Agent, hid: number, body: Record<string, unknown>) {
  const res = await agent.post(`/api/households/${hid}/transactions`).send(body);
  if (res.status !== 201) throw new Error(`txn failed: ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}
