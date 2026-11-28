// D36: ln(B/A) of a full-run A/B (scripts/perf/full-ab.sh) with a Student t
// interval. The measured passes pair up in order (1-2, 3-4, …); each pair has
// one A and one B, and d = ln(p95 B) − ln(p95 A). The SD is pooled within the
// two orders of a pair (A first, B first), so a position effect stays out of
// the noise; with ABBA then BAAB that is 2 degrees of freedom (t = 4.303).
//   node scripts/perf/analyze-ab.mjs scripts/perf/results/<label>.tsv
import { readFileSync } from "node:fs";

const T975 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228 };

export function analyze(rows) {
  const passes = rows.filter((r) => /^p\d+-/.test(r.pass)).sort((a, b) => parseInt(a.pass.slice(1)) - parseInt(b.pass.slice(1)));
  if (passes.length < 4 || passes.length % 2) throw new Error(`need an even number of measured passes, got ${passes.length}`);
  const pairs = [];
  for (let i = 0; i < passes.length; i += 2) {
    const [x, y] = [passes[i], passes[i + 1]];
    if (x.arm === y.arm) throw new Error(`passes ${x.pass} and ${y.pass} are the same arm`);
    const a = x.arm === "A" ? x : y, b = x.arm === "B" ? x : y;
    pairs.push({ first: x.arm, a: +a.p95_ms, b: +b.p95_ms, d: Math.log(+b.p95_ms) - Math.log(+a.p95_ms) });
  }
  const mean = pairs.reduce((s, p) => s + p.d, 0) / pairs.length;
  const groups = ["A", "B"].map((f) => pairs.filter((p) => p.first === f).map((p) => p.d)).filter((g) => g.length);
  const ss = groups.reduce((s, g) => { const m = g.reduce((x, y) => x + y, 0) / g.length; return s + g.reduce((x, y) => x + (y - m) ** 2, 0); }, 0);
  const df = pairs.length - groups.length;
  const sd = df > 0 ? Math.sqrt(ss / df) : NaN, se = sd / Math.sqrt(pairs.length), t = T975[df] ?? NaN;
  return { pairs, mean, sd, se, df, t, low: mean - t * se, high: mean + t * se };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [header, ...lines] = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => l.split("\t"));
  const rows = lines.map((l) => Object.fromEntries(header.map((h, i) => [h, l[i]])));
  const r = analyze(rows);
  for (const p of r.pairs) console.log(`${p.first} first: A ${p.a} ms, B ${p.b} ms, ln(B/A) ${p.d >= 0 ? "+" : ""}${p.d.toFixed(3)}`);
  const f = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
  console.log(`mean ln(B/A) ${f(r.mean)} (ratio ${Math.exp(r.mean).toFixed(3)}); pooled SD ${r.sd.toFixed(3)} (df ${r.df}); SE ${r.se.toFixed(3)}`);
  console.log(`95 % interval, t(${r.df}) = ${r.t}: ${f(r.low)} to ${f(r.high)}`);
}
