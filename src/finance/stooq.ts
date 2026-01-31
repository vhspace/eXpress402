const STOOQ_BASE_URL = "https://stooq.com/q/d/l/";

type StooqRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function fetchLatestStooqPrice(symbol: string): Promise<StooqRow> {
  const normalized = normalizeStooqSymbol(symbol);
  const end = new Date();
  const start = new Date(end.getTime() - 1000 * 60 * 60 * 24 * 30);
  const url = new URL(STOOQ_BASE_URL);
  url.searchParams.set("s", normalized);
  url.searchParams.set("i", "d");
  url.searchParams.set("d1", formatDate(start));
  url.searchParams.set("d2", formatDate(end));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Stooq request failed: ${response.status}`);
  }
  const csv = await response.text();
  const rows = parseCsv(csv);
  if (rows.length === 0) {
    throw new Error("Stooq returned no data");
  }
  return rows[rows.length - 1];
}

function parseCsv(csv: string): StooqRow[] {
  const lines = csv.trim().split("\n");
  const rows: StooqRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [date, open, high, low, close, volume] = lines[i].split(",");
    if (!date || !close) {
      continue;
    }
    rows.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume)
    });
  }
  return rows;
}

function normalizeStooqSymbol(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed.includes(".")) {
    return trimmed;
  }
  return `${trimmed}.US`;
}

function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
