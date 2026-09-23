import 'dotenv/config';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

// ─── Config ──────────────────────────────────────────────────────────────────
const RPC_URL = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!ESCROW_ADDRESS)    { console.error('❌ ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!ADMIN_PRIVATE_KEY) { console.error('❌ ADMIN_PRIVATE_KEY not set'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ESCROW_ABI = [
  'function declareWinner(bytes32 matchId, address winner) external',
  'function getMatch(bytes32 matchId) external view returns (address, uint256, uint256, uint256, uint256, address, uint8, bool, uint256, address[10])'
];

const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet);

// ─── Helpers ────────────────────────────────────────────────────────────────
const uuidToBytes32 = (uuid) => {
  const hex = uuid.replace(/-/g, '');
  return '0x' + hex.padEnd(64, '0');
};

// ─── Declare Winner ─────────────────────────────────────────────────────────
const declareWinnerOnChain = async (matchId, winnerAddress) => {
  const matchIdBytes32 = uuidToBytes32(matchId);

  console.log(`\n🏆 Declaring winner for match ${matchId.slice(0,8)}...`);
  console.log(`   Winner: ${winnerAddress}`);

  try {
    const tx = await escrowContract.declareWinner(matchIdBytes32, winnerAddress);
    console.log(`   TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

    return tx.hash;
  } catch (err) {
    console.error(`   ❌ declareWinner failed:`, err.reason || err.message);
    throw err;
  }
};

// ─── Main Processor ─────────────────────────────────────────────────────────
const processFinishedMatches = async () => {
  console.log('\n🔍 Checking for finished matches to declare winner...');

  const { data: matches, error } = await supabase
    .from('matches')
    .select('*, match_players(*)')
    .eq('status', 'finished')
    .not('winner_wallet', 'is', null)
    .is('declare_tx', null);

  if (error) {
    console.error('Supabase error:', error);
    return;
  }

  if (!matches || matches.length === 0) {
    console.log('   No pending matches found.');
    return;
  }

  console.log(`   Found ${matches.length} match(es) to process.`);

  for (const match of matches) {
    try {
      // Verify winner is in the player list
      const players = match.match_players ? match.match_players.map(p => p.wallet_address.toLowerCase()) : [];
      if (!players.includes(match.winner_wallet.toLowerCase())) {
        console.error(`   ❌ Winner ${match.winner_wallet} not in player list for match ${match.id}`);
        continue;
      }

      const txHash = await declareWinnerOnChain(match.id, match.winner_wallet);

      await supabase
        .from('matches')
        .update({ declare_tx: txHash })
        .eq('id', match.id);

      console.log(`   ✅ Match ${match.id.slice(0,8)}... successfully declared`);
    } catch (err) {
      console.error(`   ❌ Failed to process match ${match.id.slice(0,8)}:`, err.message);
    }
  }
};

// ─── Start Watcher ───────────────────────────────────────────────────────────
const start = async () => {
  console.log('🚀 FastFinger Winner Declarer Started (Robinhood Chain)');
  console.log(`   Admin: ${adminWallet.address}`);
  console.log(`   Escrow: ${ESCROW_ADDRESS}`);

  await processFinishedMatches();
  setInterval(processFinishedMatches, 15000); // every 15 seconds
};

start().catch(console.error);