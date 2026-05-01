# tradallo-agent-example

A reference agent that **queries Tradallo for a verified track record before delegating capital**. Cryptographically verifies every reputation response.

This is the pattern. Fork it, drop in your own delegation policy, point it at your own capital routing — the reputation gate stays the same.

```bash
git clone https://github.com/tradallo/agent.git
cd agent
pnpm install
pnpm start alpha-momentum-v3 10000

# → Querying Tradallo for @alpha-momentum-v3 (agent)...
# ✓ signature verified end-to-end
#   level: verified_blue
#   anchor: 2026-04-30T17:48:25Z
#   trades: 412, sharpe: 2.14, dd: 18.3%
#
# DELEGATE $10,000 USDC → @alpha-momentum-v3
#   why: all thresholds satisfied: 412 trades, sharpe 2.14, dd 18.3%
```

## Why this matters

Identity (who is the agent) and payments (how does it pay) are solved in 2026 — x402, MPP, Coinbase Agentic Wallets, ERC-8004.

**Reputation is the unsolved layer.** When your agent decides whether to delegate capital, copy trades, or subscribe to signals from another agent, it needs an answer to *"is their record real?"*

Tradallo answers it cryptographically. This repo shows you how to consume that answer in 50 lines.

## Architecture

Two files. Read them.

- **[`src/policy.ts`](./src/policy.ts)** — pure decision function. Inputs: a Tradallo track record + your thresholds. Output: `{ decide: "delegate" | "refuse", reasons: [...] }`. No I/O. Fork this and replace with your own policy.
- **[`src/index.ts`](./src/index.ts)** — CLI wrapper. Fetches the record via [`@tradallo/reputation`](https://www.npmjs.com/package/@tradallo/reputation) (which JCS-canonicalizes + ed25519-verifies the response against the published pubkey at `tradallo.com/.well-known/`), then calls `decide()`, then logs DELEGATE or REFUSE.

The verification flow happens INSIDE `client.getSigned()` — if the signature is invalid, the replay window expired, or the published pubkey isn't found, the call throws and the agent refuses to delegate. **You never see unverified data.**

## Configuration

```bash
pnpm start <handle> <amount_usdc> [options]
```

| Flag | Default | What |
|---|---|---|
| `--min-sharpe N` | 1.5 | Minimum annualized Sharpe ratio |
| `--max-drawdown N` | 0.25 | Maximum drawdown as a fraction (0.25 = 25%) |
| `--min-trades N` | 200 | Minimum trade count in the track record |
| `--min-anchor-days N` | 30 | Minimum days since the record's anchor (post-registration history) |
| `--required-level` | `verified_blue` | `verified_blue` or `verified_gold` |
| `--human` | off | Look up a human profile instead of an agent |

## Examples

```bash
# Conservative gold-only with longer history requirement
pnpm start alpha-momentum-v3 50000 \
  --required-level verified_gold \
  --min-sharpe 2.0 \
  --max-drawdown 0.15 \
  --min-anchor-days 90

# Discovery first, then per-candidate decision
npx -y @tradallo/reputation search --min-sharpe 1.5 --principal agent --limit 5
# (pipe results into your own loop)

# Inspect a candidate as a pretty card before deciding
npx -y @tradallo/reputation card alpha-momentum-v3 --agent
```

## Embedding in your agent

Skip the CLI; use the policy directly:

```ts
import { TradalloClient } from "@tradallo/reputation";
import { decide } from "tradallo-agent-example/dist/policy.js";

const client = new TradalloClient();
const record = await client.getSigned(
  `/api/v1/agents/${candidate}/track-record`,
);
const result = decide(record, { minSharpe: 1.5, maxDrawdown: 0.25, minTrades: 200 });
if (result.decide === "delegate") {
  // ... route capital
}
```

## Tests

```bash
pnpm test
```

10 cases covering thresholds, verification levels, anchor age, gold-vs-blue requirement, and multi-failure aggregation.

## Spec & docs

- Tradallo Verified Record Protocol: [github.com/tradallo/tradallo/blob/main/docs/PROTOCOL.md](https://github.com/tradallo/tradallo/blob/main/docs/PROTOCOL.md)
- MCP server (alternative consumption surface): [`@tradallo/reputation`](https://www.npmjs.com/package/@tradallo/reputation)
- Spec v1.1: [github.com/tradallo/tradallo/blob/main/docs/SPEC_V1.1.md](https://github.com/tradallo/tradallo/blob/main/docs/SPEC_V1.1.md)

## License

MIT
