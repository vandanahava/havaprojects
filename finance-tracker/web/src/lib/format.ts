let currency = "USD";
let locale = "en-US";

export function setLocale(c: string, l: string) {
  currency = c;
  locale = l;
}

export function fmtMoney(n: number, opts: { sign?: boolean; cents?: boolean } = {}): string {
  const { sign = false, cents = true } = opts;
  const f = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
    signDisplay: sign ? "exceptZero" : "auto",
  });
  return f.format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat(locale, {
    style: "currency", currency, notation: "compact", maximumFractionDigits: 1,
  }).format(n);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function fmtMonth(yyyymm: string): string {
  const d = new Date(yyyymm + "-01T00:00:00");
  return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function fmtMonthShort(yyyymm: string): string {
  const d = new Date(yyyymm + "-01T00:00:00");
  return d.toLocaleDateString(locale, { month: "short" });
}

export function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
