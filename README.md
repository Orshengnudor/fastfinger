# FastFinger

Real-time multiplayer reaction game staking **$RAREFRIENDS (RF)** on
**Robinhood Chain mainnet**. Skill decides the winner; the `FastFingerEscrow`
contract decides the payout: 90% to the winner (92% with a hardwired Rare
Friends Generations NFT). See `contracts/` for the escrow and
`contracts/README.md` for deploy steps - mainnet only, no testnet path.

A from-scratch project for the [rarefriends.com](https://rarefriends.com)
ecosystem - not a continuation of any earlier Base/ETH build.

## Environment variables

Copy these into `.env` (Vite only exposes vars prefixed `VITE_`):

```bash
# The FastFingerEscrow deployment address (from contracts/script/DeployMainnet.s.sol's output)
VITE_ESCROW_CONTRACT=0x...

# Optional - defaults to the public Robinhood mainnet RPC
VITE_ROBINHOOD_RPC=

# WalletConnect Cloud project ID - create one free at https://cloud.walletconnect.com
VITE_WALLETCONNECT_PROJECT_ID=

# Supabase
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

The RF token and Generations addresses are hardcoded in `src/lib/blockchain.js`
(confirmed at rarefriends.com/docs/contracts) - no env var needed for those.

## Database

Run `supabase/migrations/20260922_fastfinger_robinhood.sql` against your
Supabase project - it moves `matches.tier` from string keys (`'bronze'`) to
the numeric index the contract uses (`0`), and replaces the leaderboard's old
points columns with `total_rf_won`.

## Backend (winner declarer)

`scripts/declareWinners.js`, `scripts/declareWinnersOnce.js`, the Supabase
edge function, and the GitHub Action read `ROBINHOOD_RPC` and
`ESCROW_CONTRACT_ADDRESS`, and sign with `ADMIN_PRIVATE_KEY` - this must be
the same wallet you passed as `ORACLE_ADDRESS` when deploying.

**Known gap, not yet fixed:** the declarer trusts whatever `winner_wallet` the
client wrote to Supabase, rather than recomputing the winner itself from
`match_players`. Real RF is at stake on mainnet - this should move server-side
before real traffic, along with Supabase RLS/column-grants that stop the anon
key from writing `winner_wallet`, `status`, or `declare_tx` directly. See the
full step-by-step for how to prioritize this.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
