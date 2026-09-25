# FastFinger

A real-time multiplayer reaction game where players stake real $RAREFRIENDS (RF) on Robinhood Chain mainnet. Skill decides who wins. Two smart contracts decide the payout. Every match permanently burns RF.

**Live:** https://fastfinger.xyz
**Rare Friends Vibeathon entry:** Economy Potential (primary), Token Activity (secondary)

## Why this is different from a typical hackathon entry

This is not a simulated economy. There is no mock balance, no pretend token, no "coming soon" contract. Both smart contracts below are deployed on Robinhood Chain mainnet right now, independently verified on Blockscout, and have processed real $RAREFRIENDS stakes, real on-chain winner declarations, and real claims, tested end to end with actual money before this README was written. Check the burn events on either contract: that RF has genuinely left circulation, not a number in a spreadsheet.

That is the whole bet this project makes: a working, real, deflationary game is worth more to the Rare Friends economy than a well-designed mockup of one.

## Try it now

- **Play:** https://fastfinger.xyz, connect a wallet holding RF and Robinhood ETH, or try Practice mode first with no wallet at all.
- **Verify the contracts yourself:** both Blockscout links below have live Read/Write tabs.
- **Check a real burn:** any completed match's claim transaction on Blockscout will show a `Burned` event.

## How the game works

A player picks a tier (a fixed RF entry fee), creates a match, and waits for opponents to join, or joins an already-open one. Once the table fills, or the host starts early, every player gets the exact same 60-second window to react to targets appearing on screen. Highest score wins.

There are two modes, running on two separate contracts.

### Standard mode

2 to 10 players. One round. Winner takes the whole pot: 90 percent, or 92 percent if they claim while holding a hardwired Rare Friends Generations NFT (generation 1 through 6). The remaining 10 percent (or 8 percent) is the rake.

### Elimination mode

5 to 10 players only, since a smaller table leaves nothing meaningful to eliminate. Round one is everyone at once; the top two scorers advance to a second, final head-to-head round, and the best of everyone else takes third place automatically, no extra round needed for that. A flat 90 percent of the pot splits 60 percent to first, 25 percent to second, 15 percent to third. No Friend bonus in this mode yet, see Known Limitations for exactly why. It is a deliberate, documented choice, not an oversight.

### Practice mode

The same 60-second reaction round, no wallet, no stake, personal best saved to the device. Exists purely so a new player can learn the mechanics before risking RF.

### Season pool

A separate, owner-funded prize pool that pays out to the top 5 wallets by cumulative in-game score over a rolling period, independent of match winnings. Funded and paid out manually by the project owner; the app just displays the live pool balance and tracks who was paid.

## How to play

1. **Connect a wallet.** Any EVM wallet works, MetaMask, Rabby, or WalletConnect, on Robinhood Chain (chain ID 4663). You need RF for the stake and a small amount of Robinhood ETH for gas, two separate assets.
2. **Choose a tier.** Bronze (10 RF) up to Elite (1,000 RF).
3. **Create or join a match.** The contract pulls that tier's RF from your wallet via an approval and locks it. The site itself never holds the tokens at any point.
4. **Play the 60-second round.** Click targets as they appear. Normal targets score 1x points, Fast targets (smaller, quicker) score 2x, Bonus targets (rare, small) score 3x, and Trap targets cost you points if clicked. Hitting a target quickly earns a Perfect, Good, or OK timing bonus on top, and every 5-hit streak adds a 0.5x combo multiplier to your score.
5. **Highest score wins.** If two or more players tie on score, the tiebreak goes to whoever had the faster average reaction time, decided automatically and immediately, no extra round required.
6. **Claim from the Dashboard.** The declared winner (or, in elimination mode, each of the top 3 independently) claims their RF once the backend has confirmed the result on-chain, typically within a couple of minutes.

## The math, worked through

Every number below is a `constant` in the contract, fixed at compile time. Nothing here is owner-adjustable after deployment.

### Standard mode, 2 players (the minimum table size)

| Tier | Entry | Pot | Winner (90%) | Winner with Friend (92%) |
|---|---|---|---|---|
| Bronze | 10 | 20 | 18 | 18.4 |
| Silver | 25 | 50 | 45 | 46 |
| Gold | 50 | 100 | 90 | 92 |
| Platinum | 100 | 200 | 180 | 184 |
| Diamond | 250 | 500 | 450 | 460 |
| Elite | 1,000 | 2,000 | 1,800 | 1,840 |

### Standard mode, 10 players (the maximum table size)

| Tier | Entry | Pot | Winner (90%) | Winner with Friend (92%) |
|---|---|---|---|---|
| Bronze | 10 | 100 | 90 | 92 |
| Silver | 25 | 250 | 225 | 230 |
| Gold | 50 | 500 | 450 | 460 |
| Platinum | 100 | 1,000 | 900 | 920 |
| Diamond | 250 | 2,500 | 2,250 | 2,300 |
| Elite | 1,000 | 10,000 | 9,000 | 9,200 |

Every value in between scales linearly with the number of players; the rake (10%, or 8% with a Friend) burns in full until a rewards receiver is configured, then splits 50/50 between burn and that receiver.

### Elimination mode, 5 players (the minimum table size)

| Tier | Entry | Pot | Distributable (90%) | 1st (60%) | 2nd (25%) | 3rd (15%) |
|---|---|---|---|---|---|---|
| Bronze | 10 | 50 | 45 | 27 | 11.25 | 6.75 |
| Silver | 25 | 125 | 112.5 | 67.5 | 28.125 | 16.875 |
| Gold | 50 | 250 | 225 | 135 | 56.25 | 33.75 |
| Platinum | 100 | 500 | 450 | 270 | 112.5 | 67.5 |
| Diamond | 250 | 1,250 | 1,125 | 675 | 281.25 | 168.75 |
| Elite | 1,000 | 5,000 | 4,500 | 2,700 | 1,125 | 675 |

### Elimination mode, 10 players (the maximum table size)

| Tier | Entry | Pot | Distributable (90%) | 1st (60%) | 2nd (25%) | 3rd (15%) |
|---|---|---|---|---|---|---|
| Bronze | 10 | 100 | 90 | 54 | 22.5 | 13.5 |
| Silver | 25 | 250 | 225 | 135 | 56.25 | 33.75 |
| Gold | 50 | 500 | 450 | 270 | 112.5 | 67.5 |
| Platinum | 100 | 1,000 | 900 | 540 | 225 | 135 |
| Diamond | 250 | 2,500 | 2,250 | 1,350 | 562.5 | 337.5 |
| Elite | 1,000 | 10,000 | 9,000 | 5,400 | 2,250 | 1,350 |

No Friend bonus applies in elimination mode. See Known Limitations for why.

## Contracts

### FastFingerEscrow (standard mode)

- Address: `0x290f7a0213523173e1FA8305FaCC06B10DE60094`
- Verified, exact match: https://robinhoodchain.blockscout.com/address/0x290f7a0213523173e1FA8305FaCC06B10DE60094
- Source: `contracts/src/FastFingerEscrow.sol`

### FastFingerEliminationEscrow (elimination mode)

- Address: `0x9E9f0F208055cC59A1768bB03CFA633837159BB4`
- Verified, partial match. Opcodes confirmed identical to source; a post-deploy comment edit changed only the embedded metadata hash, not any compiled logic: https://robinhoodchain.blockscout.com/address/0x9E9f0F208055cC59A1768bB03CFA633837159BB4
- Source: `contracts/src/FastFingerEliminationEscrow.sol`

Deployed and kept as two entirely separate contracts on purpose. The standard contract stays untouched and live as new modes are added, rather than being migrated or replaced.

Both: Solidity `0.8.28`, optimizer on (200 runs), EVM version `cancun`, license MIT.

## Contract functions

### FastFingerEscrow

Player actions: `createMatch(matchId, tier, maxPlayers)` stakes the tier entry and opens a match. `joinMatch(matchId)` stakes into an open match. `startMatch(matchId)` lets the host close joins early once at least two players are in. `cancelMatch(matchId)` lets a still-solo host get their stake back. `claimPrize(matchId, friendId)` lets the declared winner claim, pass a hardwired Friend ID for 92 percent, or `0` for 90 percent.

Oracle only: `declareWinner(matchId, winner)` records the winner of a locked match; the winner must actually be a player in that match.

Permissionless safety valves: `sweepUnclaimed(matchId)` after 7 days unclaimed. `refundStale(matchId)` after 3 days with no winner declared.

Owner only: `setOracle(address)`. `setRewards(address)`, requires a real contract address, reverts on a plain wallet.

Views: `tierEntry(tier)`, `split(pot, friend)`, `isEligibleFriend(account, friendId)`, `getMatch(matchId)`, `getPlayers(matchId)`.

### FastFingerEliminationEscrow

Same player-action shape as above (`createMatch`, `joinMatch`, `startMatch`, `cancelMatch`), except `maxPlayers` must be 5 to 10, and `claimPrize(matchId)` takes no Friend ID since this mode has no Friend bonus; each of first, second, and third place can claim independently, in any order.

Oracle only: `declareResults(matchId, first, second, third)` records all three placements for a locked match at once, fixing all three payout amounts in the same call. All three must be distinct actual players in that match.

Same permissionless safety valves and owner functions as the standard contract.

## Every address involved

| Address | Role |
|---|---|
| `0x0779369854d3EcdEA927206718FFD7730C67B71f` | $RAREFRIENDS (RF), Rare Friends' own token contract |
| `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` | Generations, Rare Friends' own contract, read only, used to check Friend eligibility |
| `0x290f7a0213523173e1FA8305FaCC06B10DE60094` | FastFingerEscrow |
| `0x9E9f0F208055cC59A1768bB03CFA633837159BB4` | FastFingerEliminationEscrow |
| `0xdf49439509fD864Bb4d84bF6f8f58B65929ceA78` | Oracle, a single EOA, not a multisig, the only address that can call `declareWinner` or `declareResults` |
| verify live via `owner()` on either contract | Owner, the deploying wallet, can only call `setOracle` and `setRewards` |
| `0x0000000000000000000000000000000000dEaD` | Dead-burn fallback if the RF token's own `burn()` call fails |
| Unset, `address(0)` | Rewards receiver on both contracts, see below |

**Rewards receiver:** currently unset on both contracts. There is no documented, verified entry point yet for handing RF to a real Rare Friends reward stream; guessing at one risks it getting stuck. Until a real receiver is confirmed, the entire rake burns instead, still deflationary, still benefits every RF holder. The owner can call `setRewards(address)` at any time once a real receiver exists, no redeploy needed. The contract reverts with `RewardsNotContract` if the address given is a plain wallet rather than an actual contract.

## What the oracle can and cannot do

The oracle is the one privileged, actively used role, so its exact boundaries matter.

Can: call `declareWinner` or `declareResults` on a locked match, deciding who is eligible to claim that match's pot.

Cannot: declare anyone who did not actually stake into that specific match. Both functions check `isPlayer[matchId][address]` on-chain and revert otherwise. It also cannot withdraw, redirect, or otherwise move RF anywhere; there is no function on either contract that sends funds to an arbitrary address. Every fund movement is either a stake in, a claim to a declared winner, a burn, a refund, or a rewards payment, none of them gated behind a privileged call that bypasses those rules.

The oracle's actual decision-making, how it determines who really won based on in-game score, happens off-chain, in `scripts/declareWinners.js`, `scripts/declareWinnersOnce.js`, and `supabase/functions/declare-winner/`. That logic never trusts a client-reported winner; it always recomputes from server-recorded match scores before ever calling the contract.

## Permissionless safety valves

Anyone, not just the oracle or owner, can call these:

- `refundStale(matchId)`: a match locked but never declared within 3 days refunds every player in full.
- `sweepUnclaimed(matchId)`: a declared prize never claimed within 7 days gets burned (or split with rewards) rather than sitting forever.
- `cancelMatch(matchId)`: a still-empty match's host can cancel and get their own stake back.

## Architecture

Frontend: React and Vite, deployed on Vercel, in `src/`.

Contracts: Foundry, in `contracts/`. Full test suite in `contracts/test/`.

Backend: a winner declarer running on three independent, redundant paths: a GitHub Action every 5 minutes, a Supabase edge function on `pg_cron` every minute, and a manual one-shot script for local testing. Any one of the three alone is enough to keep the game functional.

Database: Supabase, Postgres, with row-level security locking the trust-sensitive columns (`winner_wallet`, `declare_tx`, and the elimination-mode equivalents) so the anon key used by the frontend can never write them; only the backend's service role can.

### Tech stack

React, Vite, wagmi, viem, ConnectKit for wallet connection, ethers.js for contract calls, Supabase for the database and edge functions, Foundry for contracts, Solidity 0.8.28, OpenZeppelin for `Ownable2Step`, `ReentrancyGuard`, and `SafeERC20`, Vercel for hosting, GitHub Actions for scheduled automation.

### Repo structure

fastfinger/
contracts/
src/ the two escrow contracts, plus mocks used only in tests
test/ the full Foundry test suite, 44 tests
script/ deploy scripts for both contracts
src/
components/ React components, one per screen or major UI piece
lib/ blockchain.js (contract calls), supabase.js (database), gameEngine.js (the reaction game itself)
scripts/ the two Node.js winner-declarer scripts
supabase/
migrations/ every schema change, in order
functions/ the pg_cron-driven edge function
.github/workflows/ the GitHub Action declarer


## Test coverage

FastFingerEscrow: 30 out of 30 tests, including a 512-run fuzz test across every tier, table size, and Friend-bonus scenario.

FastFingerEliminationEscrow: 14 out of 14 tests, including a 512-run fuzz test across every tier, player count, and placement combination.

44 out of 44 total. Full suite in `contracts/test/`.

Both contracts were additionally exercised with real, small-value transactions on Robinhood Chain mainnet: actual stakes, actual declarations, actual claims, not only local test runs.

## Known limitations, stated plainly

No anti-bot protection yet. A client's reported score is currently taken at face value before being used to compute a winner. Nothing on-chain is affected, since the contract only ever pays out real match participants, but a scripted client could currently inflate its own score. This is the next planned piece of work.

No Genesis NFT tier. Only Generations hardwiring is checked for the Friend bonus. A higher-percentage tier for Genesis holders was discussed but never built, since the exact eligibility rule was never finalized.

Elimination mode has no Friend bonus at all, a deliberate choice, documented directly in that contract's own NatSpec: with three independent claimants sharing one pot-wide rake decision, making the rake depend on claim order is a real fairness question that deserves its own careful pass rather than being rushed in.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Environment variables

```bash
# Contracts
VITE_ESCROW_CONTRACT=0x290f7a0213523173e1FA8305FaCC06B10DE60094
VITE_ELIMINATION_ESCROW=0x9E9f0F208055cC59A1768bB03CFA633837159BB4

# Optional, defaults to the public Robinhood mainnet RPC
VITE_ROBINHOOD_RPC=

# WalletConnect Cloud project ID, free at https://cloud.walletconnect.com
VITE_WALLETCONNECT_PROJECT_ID=

# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Wallet allowed to see the season-pool admin panel in the app
VITE_ADMIN_WALLET=
```

The RF token and Generations addresses are hardcoded in `src/lib/blockchain.js`, confirmed against rarefriends.com/docs/contracts. No env var is needed for those.

## Database

Run every file in `supabase/migrations/` against your Supabase project, in filename order.

## Backend setup

`scripts/declareWinners.js`, `scripts/declareWinnersOnce.js`, the Supabase edge function, and the GitHub Action all read `ROBINHOOD_RPC`, `ESCROW_CONTRACT_ADDRESS`, and `ELIMINATION_ESCROW_ADDRESS`, and sign with `ADMIN_PRIVATE_KEY`, which must be the same wallet passed as `ORACLE_ADDRESS` at deploy time.
