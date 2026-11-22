const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Swiss-style grouping with a typographic apostrophe: CHF 12’300 */
export function num(x: number, digits = 0): string {
  const s = Math.abs(x).toFixed(digits);
  const [i, d] = s.split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
  return (x < 0 && Math.abs(x) >= 0.5 * 10 ** -digits ? "−" : "") + grouped + (d ? "." + d : "");
}

export function chf(x: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const sign = opts.sign && x > 0 ? "+" : "";
  if (opts.compact && Math.abs(x) >= 10_000) {
    if (Math.abs(x) >= 1_000_000) return `${sign}CHF ${num(x / 1_000_000, 2)}M`;
    return `${sign}CHF ${num(x / 1000, Math.abs(x) >= 100_000 ? 0 : 1)}k`;
  }
  return `${sign}CHF ${num(x)}`;
}

export function chfShort(x: number): string {
  if (Math.abs(x) >= 1_000_000) return `${num(x / 1_000_000, 1)}M`;
  if (Math.abs(x) >= 1000) return `${num(x / 1000, 0)}k`;
  return num(x);
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function monthLabel(m: string | null | undefined, short = false): string {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  const name = MONTHS[Number(mo) - 1];
  return short ? `${name} ’${y.slice(2)}` : `${name} ${y}`;
}

export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const o = y * 12 + (mo - 1) + n;
  return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, "0")}`;
}

export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;
}
