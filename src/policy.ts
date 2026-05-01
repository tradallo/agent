/**
 * Delegation policy — the pure decision function.
 *
 * Inputs: a verified Tradallo track record + a set of thresholds.
 * Output: { decide: "delegate" | "refuse", reasons: string[] }.
 *
 * Pure function. No I/O. Easy to test. The CLI in src/index.ts wraps
 * this with the API call + signature verification (handled by
 * @tradallo/reputation), but you could just as easily use the same
 * function inside a LangChain tool, a Cursor extension, a webhook
 * handler, etc.
 */

export type Thresholds = {
  /** Minimum annualized Sharpe ratio (rolling window). Required. */
  minSharpe: number;
  /** Maximum drawdown as a fraction (e.g. 0.25 = 25%). Required. */
  maxDrawdown: number;
  /** Minimum trade count in the window. Required. */
  minTrades: number;
  /** Verification level required: "verified_blue" or "verified_gold". Default: blue. */
  requiredLevel?: "verified_blue" | "verified_gold";
  /** Minimum days since the record's anchor (post-registration window). Default: 0. */
  minAnchorDays?: number;
};

export type WindowStats = {
  trade_count: number;
  win_rate: number;
  net_pnl_usd: number;
  sharpe_ratio: number | null;
  max_drawdown_pct: number;
};

export type TrackRecord = {
  // Common shape across human + agent endpoints.
  profile?: { handle: string };
  agent?: { handle: string };
  verification: { level: string; anchor_at: string | null };
  stats: { all_time: WindowStats };
};

export type Decision = {
  decide: "delegate" | "refuse";
  handle: string;
  reasons: string[];
};

const VERIFIED_LEVELS = new Set(["verified_blue", "verified_gold"]);

export function decide(record: TrackRecord, thresholds: Thresholds): Decision {
  const handle = record.profile?.handle ?? record.agent?.handle ?? "(unknown)";
  const reasons: string[] = [];
  const required = thresholds.requiredLevel ?? "verified_blue";

  // Verification level — gold superset of blue.
  if (!VERIFIED_LEVELS.has(record.verification.level)) {
    reasons.push(`verification level "${record.verification.level}" is not verified (need blue or gold)`);
  } else if (required === "verified_gold" && record.verification.level !== "verified_gold") {
    reasons.push(`verification level "${record.verification.level}" is not gold (required)`);
  }

  // Anchor age — protects against newly-registered records that haven't
  // proven anything yet.
  const minAnchorDays = thresholds.minAnchorDays ?? 0;
  if (minAnchorDays > 0) {
    if (!record.verification.anchor_at) {
      reasons.push(`no anchor timestamp on record (need ≥${minAnchorDays} days history)`);
    } else {
      const ageDays = (Date.now() - Date.parse(record.verification.anchor_at)) / 86_400_000;
      if (ageDays < minAnchorDays) {
        reasons.push(`record only ${ageDays.toFixed(1)} days old (need ≥${minAnchorDays})`);
      }
    }
  }

  const s = record.stats.all_time;

  if (s.trade_count < thresholds.minTrades) {
    reasons.push(`trade_count=${s.trade_count} < min ${thresholds.minTrades}`);
  }
  if (s.sharpe_ratio === null || s.sharpe_ratio < thresholds.minSharpe) {
    reasons.push(`sharpe=${s.sharpe_ratio ?? "null"} < min ${thresholds.minSharpe}`);
  }
  if (s.max_drawdown_pct > thresholds.maxDrawdown) {
    reasons.push(`max_drawdown=${(s.max_drawdown_pct * 100).toFixed(1)}% > max ${(thresholds.maxDrawdown * 100).toFixed(1)}%`);
  }

  return {
    decide: reasons.length === 0 ? "delegate" : "refuse",
    handle,
    reasons: reasons.length === 0
      ? [`all thresholds satisfied: ${s.trade_count} trades, sharpe ${s.sharpe_ratio?.toFixed(2)}, dd ${(s.max_drawdown_pct * 100).toFixed(1)}%`]
      : reasons,
  };
}
