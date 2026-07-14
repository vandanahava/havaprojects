import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { api } from "../lib/api";
import { btnPrimary, btnGhost } from "./ui";

/**
 * Bank connections happen exclusively inside Plaid Link — Plaid's own hosted
 * widget. Bank credentials are typed only into Plaid's UI and never touch
 * this app. We receive a short-lived public_token, exchange it server-side,
 * and store only the encrypted access_token + item_id.
 */
export function PlaidConnectButton({
  householdId, plaidItemId, label, onSuccess, className,
}: {
  householdId: number;
  plaidItemId?: number; // set for the reconnect (update-mode) flow
  label?: string;
  onSuccess: () => void;
  className?: string;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ link_token: string }>(
        `/api/households/${householdId}/plaid/link-token`,
        plaidItemId ? { plaid_item_id: plaidItemId } : {}
      );
      setLinkToken(res.link_token);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [householdId, plaidItemId]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      try {
        if (plaidItemId) {
          await api.post(`/api/households/${householdId}/plaid/items/${plaidItemId}/reconnected`);
        } else {
          await api.post(`/api/households/${householdId}/plaid/exchange`, {
            public_token,
            institution_name: metadata.institution?.name ?? "Bank",
          });
        }
        onSuccess();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    onExit: () => {
      setBusy(false);
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  return (
    <div className={className}>
      <button
        onClick={requestToken}
        disabled={busy}
        className={plaidItemId ? btnGhost : btnPrimary}
      >
        {busy ? "Opening…" : label ?? (plaidItemId ? "Reconnect" : "🔗 Connect a bank")}
      </button>
      {error && <p className="text-xs text-neg-text mt-1.5 max-w-xs">{error}</p>}
    </div>
  );
}
