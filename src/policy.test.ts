/**
 * Policy unit tests. Pure function, hand-crafted fixtures.
 *
 * Run: pnpm test
 */

import { decide, type TrackRecord, type Thresholds } from "./policy.ts";

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const baseRecord = (overrides: Partial<TrackRecord> = {}): TrackRecord => ({
  agent: { handle: "test-agent" },
  verification: {
    level: "verified_blue",
    anchor_at: new Date(Date.now() - 100 * 86_400_000).toISOString(),
  },
  stats: {
    all_time: {
      trade_count: 500,
      win_rate: 0.6,
      net_pnl_usd: 50_000,
      sharpe_ratio: 2.0,
      max_drawdown_pct: 0.15,
      ...((overrides.stats?.all_time as object | undefined) ?? {}),
    },
  },
  ...overrides,
});

const baseThresh: Thresholds = {
  minSharpe: 1.5,
  maxDrawdown: 0.25,
  minTrades: 200,
};

console.log("\n[1] happy path — all thresholds met");
{
  const d = decide(baseRecord(), baseThresh);
  ok("decides delegate", d.decide === "delegate", `got ${d.decide}`);
  ok("single explanatory reason", d.reasons.length === 1);
}

console.log("\n[2] sharpe too low");
{
  const r = baseRecord({ stats: { all_time: { ...baseRecord().stats.all_time, sharpe_ratio: 0.8 } } });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions sharpe", d.reasons.some((x) => x.includes("sharpe")));
}

console.log("\n[3] sharpe is null (insufficient daily samples)");
{
  const r = baseRecord({ stats: { all_time: { ...baseRecord().stats.all_time, sharpe_ratio: null } } });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions null sharpe", d.reasons.some((x) => x.includes("sharpe=null")));
}

console.log("\n[4] drawdown too high");
{
  const r = baseRecord({ stats: { all_time: { ...baseRecord().stats.all_time, max_drawdown_pct: 0.40 } } });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions drawdown", d.reasons.some((x) => x.includes("drawdown")));
}

console.log("\n[5] trade count too low");
{
  const r = baseRecord({ stats: { all_time: { ...baseRecord().stats.all_time, trade_count: 50 } } });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions trade_count", d.reasons.some((x) => x.includes("trade_count")));
}

console.log("\n[6] verification level not blue");
{
  const r = baseRecord({ verification: { level: "self_attested", anchor_at: baseRecord().verification.anchor_at } });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions verification", d.reasons.some((x) => x.includes("verification")));
}

console.log("\n[7] gold required, only blue");
{
  const d = decide(baseRecord(), { ...baseThresh, requiredLevel: "verified_gold" });
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions gold", d.reasons.some((x) => x.includes("gold")));
}

console.log("\n[8] gold satisfies blue requirement");
{
  const r = baseRecord({ verification: { level: "verified_gold", anchor_at: baseRecord().verification.anchor_at } });
  const d = decide(r, baseThresh);
  ok("decides delegate", d.decide === "delegate");
}

console.log("\n[9] anchor too recent");
{
  const r = baseRecord({
    verification: {
      level: "verified_blue",
      anchor_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), // 5 days ago
    },
  });
  const d = decide(r, { ...baseThresh, minAnchorDays: 30 });
  ok("decides refuse", d.decide === "refuse");
  ok("reason mentions anchor age", d.reasons.some((x) => x.includes("days old")));
}

console.log("\n[10] multiple failures listed together");
{
  const r = baseRecord({
    stats: {
      all_time: {
        ...baseRecord().stats.all_time,
        sharpe_ratio: 0.5,
        max_drawdown_pct: 0.5,
        trade_count: 10,
      },
    },
  });
  const d = decide(r, baseThresh);
  ok("decides refuse", d.decide === "refuse");
  ok("3 distinct failure reasons", d.reasons.length === 3, `got ${d.reasons.length}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
