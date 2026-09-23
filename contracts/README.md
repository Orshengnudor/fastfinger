# FastFinger — contracts (Robinhood Chain mainnet only)

`FastFingerEscrow` holds $RAREFRIENDS (RF) stakes. ETH is gas only. This
contract only deploys on Robinhood Chain mainnet (chain id `4663`) — the
constructor reverts anywhere else, including the Robinhood testnet.

| Contract | Address |
|---|---|
| $RAREFRIENDS (RF) | `0x0779369854d3EcdEA927206718FFD7730C67B71f` |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` |

Both hardcoded into `script/DeployMainnet.s.sol` directly (not read from env),
confirmed against https://rarefriends.com/docs/contracts.

## Economics

- Winner gets **90%** of the pot, or **92%** with a hardwired Generations
  Friend (`generation(id)` between 1 and 6, owned by the winner).
- **The rake (10%, or 8% with a Friend) is fully burned until you call
  `setRewards`.** Rare Friends' published contracts (Genesis, Generations, RF,
  ActivationManager, Hook, Market, Reserve, CCA) have no documented entry
  point for an outside contract to hand over RF and have it correctly counted
  as reward-stream funding — that stream is driven by users' own
  Activate/Hardwire/Promote/Upgrade calls through Rare Friends' own contracts,
  not by plain `transfer()`. Guessing an address risks the RF getting stuck
  rather than distributed, so it burns instead until there's a confirmed
  integration. `rewards` is an owner-settable address (not immutable) for
  exactly this reason — see `script/SetRewards.s.sol`.
- Unclaimed after 7 days: the whole pot is burned (or split 50/50 with
  `rewards`, once set) — anyone can call `sweepUnclaimed`.
- No winner declared within 3 days of a match locking: anyone can call
  `refundStale` to return every player's stake.

## Setup

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std --no-git
forge test -vv
```

## Deploy

```bash
export ROBINHOOD_RPC=https://rpc.mainnet.chain.robinhood.com
export DEPLOYER_KEY=0x...      # the wallet with Robinhood ETH for gas
export ORACLE_ADDRESS=0x...    # the wallet the winner-declarer backend signs with

# 1. Dry run — simulates against real chain state, costs nothing, no --broadcast
forge script script/DeployMainnet.s.sol --rpc-url $ROBINHOOD_RPC

# 2. If that looks right, deploy for real
forge script script/DeployMainnet.s.sol --rpc-url $ROBINHOOD_RPC --broadcast
```

Copy the `VITE_ESCROW_CONTRACT` address the script prints into the frontend's
`.env`.

## Later: pointing the rake at real rewards

If Rare Friends ever documents a real integration point for outside protocols
to fund their reward stream:

```bash
export ESCROW=0x...            # the deployed FastFingerEscrow address
export NEW_REWARDS=0x...       # must be a contract, or address(0) to go back to full-burn
forge script script/SetRewards.s.sol --rpc-url $ROBINHOOD_RPC --broadcast
```

`abi/FastFingerEscrow.json` is the ABI the frontend and declarer script use.
