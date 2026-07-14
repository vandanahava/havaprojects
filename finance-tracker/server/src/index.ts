import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createApp } from "./app.js";
import { plaidConfigured, getPlaidClient } from "./lib/plaid.js";
import { syncAllItems } from "./lib/plaidSync.js";

// Load .env from the project root (no dotenv dependency needed)
const envPath = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// Dev convenience: generate ephemeral secrets when unset so the app boots,
// with a loud warning. Production must set real values.
for (const key of ["SESSION_SECRET", "TOKEN_ENCRYPTION_KEY"] as const) {
  const val = process.env[key];
  if (!val || val.startsWith("change-me")) {
    process.env[key] = crypto.randomBytes(32).toString("hex");
    console.warn(
      `⚠️  ${key} not set — generated an ephemeral one for this run. ` +
        `Sessions/tokens won't survive restarts. Set it in .env (see .env.example).`
    );
  }
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`HearthLedger API listening on http://localhost:${port}`);
  console.log(
    plaidConfigured()
      ? `Plaid: configured (${process.env.PLAID_ENV || "sandbox"})`
      : "Plaid: not configured — bank connections disabled, manual accounts fully functional"
  );
});

// Scheduled sync: refresh balances + transactions for all connected items
// every 6 hours (Plaid Sandbox data updates infrequently; production apps
// would drive this off Plaid webhooks instead).
if (plaidConfigured()) {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const results = await syncAllItems(getPlaidClient());
      if (results.length) console.log("Scheduled Plaid sync:", JSON.stringify(results));
    } catch (err) {
      console.error("Scheduled Plaid sync failed:", err);
    }
  }, SIX_HOURS).unref();
}
