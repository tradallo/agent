#!/usr/bin/env node
/**
 * Reference agent: should I delegate capital to <agent_handle>?
 *
 * Workflow:
 *   1. Fetch the candidate's verified track record from Tradallo
 *      (signature-checked end-to-end by the @tradallo/reputation client).
 *   2. Apply a configurable delegation policy (Sharpe, drawdown, trade
 *      count, anchor age, verification level).
 *   3. Print DELEGATE or REFUSE with a clear reason.
 *
 * The reputation gate is the whole point. Replace the policy with your
 * own; replace the "DELEGATE" log with an actual capital routing call;
 * replace the CLI with whatever surface your agent exposes. The pattern
 * is what matters.
 *
 * Usage:
 *   pnpm start <agent_handle> <amount_usdc> [options]
 *
 * Options:
 *   --min-sharpe N       Default 1.5
 *   --max-drawdown N     Default 0.25 (= 25%)
 *   --min-trades N       Default 200
 *   --min-anchor-days N  Default 30
 *   --required-level     "verified_blue" (default) | "verified_gold"
 *   --human              Look up a human profile instead of an agent
 *
 * Examples:
 *   pnpm start alpha-momentum-v3 10000
 *   pnpm start alpha-momentum-v3 50000 --min-sharpe 2 --required-level verified_gold
 *   pnpm start ajdotink 1000 --human --min-trades 50
 */

import { TradalloClient } from "@tradallo/reputation";
import { decide, type TrackRecord, type Thresholds } from "./policy.js";

const ESC = "\x1b[";
const c = {
  reset: ESC + "0m",
  dim: ESC + "2m",
  bold: ESC + "1m",
  green: ESC + "38;5;40m",
  red: ESC + "38;5;203m",
  cyan: ESC + "38;5;44m",
  grey: ESC + "38;5;245m",
};
const NO_COLOR = process.env.NO_COLOR != null || !process.stdout.isTTY;
const paint = (color: string, s: string) => (NO_COLOR ? s : `${color}${s}${c.reset}`);

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
${paint(c.bold, "tradallo-agent-example")} ${paint(c.dim, "— delegate-or-refuse reference")}

${paint(c.bold, "Usage")}: pnpm start <handle> <amount_usdc> [options]

${paint(c.bold, "Options")}:
  --min-sharpe N        Default 1.5
  --max-drawdown N      Default 0.25 (= 25%)
  --min-trades N        Default 200
  --min-anchor-days N   Default 30
  --required-level      verified_blue (default) | verified_gold
  --human               Look up a human profile instead of an agent

${paint(c.bold, "Examples")}:
  pnpm start alpha-momentum-v3 10000
  pnpm start alpha-momentum-v3 50000 --required-level verified_gold
  pnpm start ajdotink 1000 --human --min-trades 50
`);
    process.exit(args.length < 2 ? 2 : 0);
  }

  const handle = args[0]!;
  const amountUsdc = Number(args[1]);
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    console.error(paint(c.red, `✗ amount_usdc must be a positive number, got "${args[1]}"`));
    process.exit(2);
  }

  const thresholds: Thresholds = {
    minSharpe: Number(arg(args, "--min-sharpe") ?? 1.5),
    maxDrawdown: Number(arg(args, "--max-drawdown") ?? 0.25),
    minTrades: Number(arg(args, "--min-trades") ?? 200),
    minAnchorDays: Number(arg(args, "--min-anchor-days") ?? 30),
    requiredLevel: (arg(args, "--required-level") ?? "verified_blue") as Thresholds["requiredLevel"],
  };
  const isHuman = flag(args, "--human");

  console.log(`\n${paint(c.dim, "→")} Querying Tradallo for ${paint(c.bold, "@" + handle)} ${paint(c.dim, isHuman ? "(human)" : "(agent)")}...`);

  const client = new TradalloClient();
  const path = isHuman
    ? `/api/v1/profiles/${encodeURIComponent(handle)}/track-record`
    : `/api/v1/agents/${encodeURIComponent(handle)}/track-record`;

  let record: TrackRecord;
  try {
    record = await client.getSigned<TrackRecord>(path);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("not_found")) {
      console.error(paint(c.red, `✗ ${handle} not found${isHuman ? "" : " (try --human if this is a profile, not an agent)"}`));
    } else {
      console.error(paint(c.red, `✗ verification failed: ${msg}`));
    }
    console.error(paint(c.dim, `\n  Refusing to delegate $${amountUsdc.toLocaleString()} — without a verified record, no capital moves.\n`));
    process.exit(1);
  }

  console.log(paint(c.green, "✓ signature verified end-to-end"));
  console.log(paint(c.dim, `  level: ${record.verification.level}`));
  console.log(paint(c.dim, `  anchor: ${record.verification.anchor_at ?? "none"}`));
  console.log(paint(c.dim, `  trades: ${record.stats.all_time.trade_count}, sharpe: ${record.stats.all_time.sharpe_ratio ?? "—"}, dd: ${(record.stats.all_time.max_drawdown_pct * 100).toFixed(1)}%`));

  const decision = decide(record, thresholds);

  console.log("");
  if (decision.decide === "delegate") {
    console.log(paint(c.green, paint(c.bold, "DELEGATE")) + ` $${amountUsdc.toLocaleString()} USDC → @${handle}`);
    console.log(paint(c.dim, `  why: ${decision.reasons[0]}`));
    console.log(paint(c.dim, `\n  (replace this log with an actual capital routing call)\n`));
    process.exit(0);
  } else {
    console.log(paint(c.red, paint(c.bold, "REFUSE")) + ` to delegate $${amountUsdc.toLocaleString()} → @${handle}`);
    console.log(paint(c.dim, "  failed thresholds:"));
    for (const r of decision.reasons) {
      console.log(paint(c.dim, `    • ${r}`));
    }
    console.log("");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(paint(c.red, `✗ fatal: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});
