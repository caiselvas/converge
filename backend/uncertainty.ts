import { simulate } from "./engine";
import type { Environment, Plan } from "./types";

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(random: () => number) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) *
    Math.cos(2 * Math.PI * random())
  );
}
function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length,
    L = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = matrix[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-10)) : s / L[j][j];
    }
  return L;
}
function solve(L: number[][], b: number[]) {
  const n = b.length,
    y = Array(n).fill(0),
    x = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x as number[];
}
export function fitGP(history: number[], horizon: number) {
  if (history.length < 4 || history.some((x) => !Number.isFinite(x)))
    throw new Error("GP requires at least four finite residual observations.");
  const n = history.length,
    mean = history.reduce((s, x) => s + x, 0) / n;
  const scale = Math.max(
    0.01,
    Math.sqrt(history.reduce((s, x) => s + (x - mean) ** 2, 0) / n),
  );
  const y = history.map((x) => (x - mean) / scale);
  let best:
    | { score: number; length: number; L: number[][]; alpha: number[] }
    | undefined;
  for (const length of [2, 4, 8, 12]) {
    const K = Array.from({ length: n }, (_, i) =>
      Array.from(
        { length: n },
        (_, j) =>
          Math.exp(-0.5 * ((i - j) / length) ** 2) + (i === j ? 0.35 : 0),
      ),
    );
    const L = cholesky(K),
      alpha = solve(L, y);
    const score =
      -0.5 * y.reduce((s, v, i) => s + v * alpha[i], 0) -
      L.reduce((s, r, i) => s + Math.log(r[i]), 0) -
      (n / 2) * Math.log(2 * Math.PI);
    if (!best || score > best.score) best = { score, length, L, alpha };
  }
  const { length, L, alpha } = best!;
  const cross = Array.from({ length: horizon }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      Math.exp(-0.5 * ((n + i - j) / length) ** 2),
    ),
  );
  const posteriorMean = cross.map(
    (row) => mean + scale * row.reduce((s, v, j) => s + v * alpha[j], 0),
  );
  const solved = cross.map((row) => solve(L, row));
  const covariance = Array.from({ length: horizon }, (_, i) =>
    Array.from(
      { length: horizon },
      (_, j) =>
        scale ** 2 *
          (Math.exp(-0.5 * ((i - j) / length) ** 2) -
            cross[i].reduce((s, v, k) => s + v * solved[j][k], 0)) +
        (i === j ? 1e-8 : 0),
    ),
  );
  return { mean: posteriorMean, L: cholesky(covariance), length, scale };
}
export interface UncertaintyResult {
  bands: { low: number; median: number; high: number }[];
  baselineBands: { low: number; median: number; high: number }[];
  breachA: number;
  breachB: number;
  breachEither: number;
  baselineBreach: number;
  paths: number;
  seed: number;
  gpLength: number;
  history: number[];
  differenceLow: number;
  differenceMedian: number;
  differenceHigh: number;
}
const quantile = (sorted: number[], q: number) => {
  const x = (sorted.length - 1) * q,
    i = Math.floor(x);
  return (
    sorted[i] +
    (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (x - i)
  );
};
export function uncertainty(plan: Plan, paths = 160): UncertaintyResult {
  if (!Number.isInteger(paths) || paths < 10 || paths > 2000)
    throw new Error("Choose 10–2,000 simulation paths.");
  const random = seeded(plan.assumptions.seed);
  // Demonstration history is generated, not inferred from the UBS or Swiss population data.
  const history = Array.from(
    { length: 24 },
    (_, m) => 0.045 * Math.sin(m * 0.65) + 0.025 * normal(random),
  );
  const gp = fitGP(history, plan.months);
  const values = Array.from({ length: plan.months }, () => [] as number[]),
    baselineValues = Array.from({ length: plan.months }, () => [] as number[]);
  const diffs: number[] = [];
  let countA = 0,
    countB = 0,
    either = 0,
    baselineRisk = 0;
  for (let run = 0; run < paths; run++) {
    const z = Array.from({ length: plan.months }, () => normal(random));
    const env: Environment = {
      expenseFactors: [],
      incomeFactorsA: [],
      incomeFactorsB: [],
      investmentReturns: [],
    };
    let macro = 0,
      gapA = 0,
      gapB = 0;
    for (let m = 0; m < plan.months; m++) {
      macro = 0.8 * macro + 0.01 * normal(random);
      const latent =
        gp.mean[m] +
        gp.L[m].slice(0, m + 1).reduce((s, v, k) => s + v * z[k], 0);
      env.expenseFactors.push(
        Math.exp(latent + 0.025 * normal(random) + macro),
      );
      // Illustrative stress assumptions, not estimated unemployment probabilities.
      if (gapA === 0 && random() < 0.04 / 12) gapA = 3;
      if (gapB === 0 && random() < 0.04 / 12) gapB = 3;
      if (random() < 0.01 / 12) {
        gapA = 3;
        gapB = 3;
      }
      env.incomeFactorsA.push(gapA > 0 ? 0.2 : 1);
      env.incomeFactorsB.push(gapB > 0 ? 0.2 : 1);
      gapA = Math.max(0, gapA - 1);
      gapB = Math.max(0, gapB - 1);
      env.investmentReturns.push(
        (1 + plan.assumptions.investmentReturn) ** (1 / 12) -
          1 +
          (0.08 / Math.sqrt(12)) * normal(random),
      );
    }
    const result = simulate(plan, env),
      baseline = simulate({ ...plan, events: [] }, env);
    result.months.forEach((m, i) => values[i].push(m.totalCash));
    baseline.months.forEach((m, i) => baselineValues[i].push(m.totalCash));
    const ba = result.firstBreachA !== null,
      bb = result.firstBreachB !== null;
    countA += Number(ba);
    countB += Number(bb);
    either += Number(ba || bb);
    baselineRisk += Number(
      baseline.firstBreachA !== null || baseline.firstBreachB !== null,
    );
    diffs.push(
      result.months.at(-1)!.netWorth - baseline.months.at(-1)!.netWorth,
    );
  }
  const bands = (rows: number[][]) =>
    rows.map((row) => {
      row.sort((a, b) => a - b);
      return {
        low: quantile(row, 0.1),
        median: quantile(row, 0.5),
        high: quantile(row, 0.9),
      };
    });
  diffs.sort((a, b) => a - b);
  return {
    bands: bands(values),
    baselineBands: bands(baselineValues),
    breachA: countA / paths,
    breachB: countB / paths,
    breachEither: either / paths,
    baselineBreach: baselineRisk / paths,
    paths,
    seed: plan.assumptions.seed,
    gpLength: gp.length,
    history,
    differenceLow: quantile(diffs, 0.1),
    differenceMedian: quantile(diffs, 0.5),
    differenceHigh: quantile(diffs, 0.9),
  };
}
