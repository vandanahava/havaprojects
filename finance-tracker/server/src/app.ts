import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { authRouter } from "./routes/auth.js";
import { householdsRouter } from "./routes/households.js";
import { accountsRouter } from "./routes/accounts.js";
import { networthRouter } from "./routes/networth.js";
import { transactionsRouter } from "./routes/transactions.js";
import { budgetsRouter } from "./routes/budgets.js";
import { sharesRouter, activityRouter } from "./routes/shares.js";
import { categoriesRouter } from "./routes/categories.js";
import { reportsRouter } from "./routes/reports.js";
import { goalsRouter } from "./routes/goals.js";
import { recurringRouter } from "./routes/recurring.js";
import { plaidRouter } from "./routes/plaid.js";
import { settingsRouter } from "./routes/settings.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/households", householdsRouter);
  app.use("/api/households/:householdId/accounts", accountsRouter);
  app.use("/api/households/:householdId/networth", networthRouter);
  app.use("/api/households/:householdId/transactions", transactionsRouter);
  app.use("/api/households/:householdId/budgets", budgetsRouter);
  app.use("/api/households/:householdId/shares", sharesRouter);
  app.use("/api/households/:householdId/activity", activityRouter);
  app.use("/api/households/:householdId/categories", categoriesRouter);
  app.use("/api/households/:householdId/reports", reportsRouter);
  app.use("/api/households/:householdId/goals", goalsRouter);
  app.use("/api/households/:householdId/recurring", recurringRouter);
  app.use("/api/households/:householdId/plaid", plaidRouter);
  app.use("/api", settingsRouter);

  // Serve built frontend in production (npm run build -w web → web/dist)
  const webDist = path.resolve(import.meta.dirname, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
