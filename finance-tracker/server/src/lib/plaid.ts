import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Plaid client, Sandbox by default. Only read-only products are used
 * (Transactions + Balance) — this app never moves money.
 * Credentials come exclusively from environment variables.
 */

export function plaidConfigured(): boolean {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaidEnvName(): string {
  return process.env.PLAID_ENV || "sandbox";
}

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!plaidConfigured()) {
    throw new Error("Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env");
  }
  if (!_client) {
    const envName = plaidEnvName();
    const basePath = PlaidEnvironments[envName];
    if (!basePath) throw new Error(`Unknown PLAID_ENV "${envName}" (use sandbox|development|production)`);
    _client = new PlaidApi(
      new Configuration({
        basePath,
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
            "PLAID-SECRET": process.env.PLAID_SECRET!,
          },
        },
      })
    );
  }
  return _client;
}
