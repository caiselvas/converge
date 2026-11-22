import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";

export interface Observation {
  id: string;
  name: string;
  value: number;
  year: string;
  unit: string;
  url: string;
  retrievedAt: string;
}
export async function fetchObservations(): Promise<Observation[]> {
  const series = [
    ["FP.CPI.TOTL.ZG", "Consumer-price inflation", "% annual"],
    ["SL.UEM.TOTL.ZS", "Unemployment, ILO estimate", "% of labour force"],
    ["NY.GDP.MKTP.KD.ZG", "Real GDP growth", "% annual"],
  ];
  return Promise.all(
    series.map(async ([id, name, unit]) => {
      const url = `https://api.worldbank.org/v2/country/CHE/indicator/${id}?format=json&per_page=100`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok)
        throw new Error(`World Bank returned ${response.status}`);
      const body = (await response.json()) as [
        unknown,
        { value: number | null; date: string }[],
      ];
      if (!Array.isArray(body[1]))
        throw new Error("Unexpected World Bank response");
      const latest = body[1]
        .filter(
          (row) => typeof row.value === "number" && Number.isFinite(row.value),
        )
        .sort((a, b) => Number(b.date) - Number(a.date))[0];
      if (!latest || latest.value === null)
        throw new Error("No published observation available");
      return {
        id,
        name,
        value: latest.value,
        year: latest.date,
        unit,
        url,
        retrievedAt: new Date().toISOString(),
      };
    }),
  );
}
let cached: { data: Observation[]; expires: number } | undefined;
let inFlight: Promise<Observation[]> | undefined;
export async function observationsRoute(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  try {
    if (!cached || cached.expires < Date.now()) {
      inFlight ??= fetchObservations();
      const data = await inFlight;
      cached = { data, expires: Date.now() + 86400000 };
      inFlight = undefined;
      // Raw retrieval stays out of Git. The planner never silently replaces forecasts.
      await mkdir("data/raw", { recursive: true });
      await writeFile(
        "data/raw/world-bank-context.json",
        JSON.stringify(data, null, 2),
      );
    }
    res.end(JSON.stringify({ data: cached.data, role: "historical_context" }));
  } catch (error) {
    inFlight = undefined;
    res.statusCode = 502;
    res.end(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Official source unavailable",
      }),
    );
  }
}
