import 'dotenv/config';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const RPC_URL           = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ESCROW_ADDRESS    = process.env.ESCROW_CONTRACT_ADDRESS;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!ESCROW_ADDRESS)    { console.error('ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
if (!process.env.SUPABASE_URL) { console.error('SUPABASE_URL not set'); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }

const provider    = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
// Must use the SERVICE key here, not anon — only service_role can write
// winner_wallet/declare_tx (see supabase/migrations/00000000000000_init.sql).
const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ESCROW_ABI = [
  'function declareWinner(bytes32 matchId, address winner) external',
];
const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet);

const uuidToBytes32 = (uuid) => '0x' + uuid.replace(/-/g, '').padEnd(64, '0');

// Must match src/lib/gameEngine.js ROUND_DURATION_SEC (60s) plus a buffer for
// score-sync lag over the network before we trust a match is really over.
const ROUND_DURATION_SEC = 60;
const SETTLE_BUFFER_SEC  = 15;

/// @dev The only place a winner is ever decided. Never trust a client-supplied
/// winner_wallet — recompute from match_players every time, same tie-break as
/// the client UI uses for display (highest score, then lowest avg reaction time).
const pickWinner = (players) => {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top    = sorted[0]?.score ?? 0;
  const tied   = sorted.filter(p => p.score === top);
  return tied.length === 1
    ? tied[0]
    : tied.sort((a, b) => (a.avg_reaction_time || 9999) - (b.avg_reaction_time || 9999))[0];
};

const declareOnChain = async (match) => {
  const id = match.id.slice(0, 8);
  try {
    console.log(`[${id}] Declaring: ${match.winner_wallet}`);
    const tx = await escrowContract.declareWinner(uuidToBytes32(match.id), match.winner_wallet);
    console.log(`[${id}] TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[${id}] Confirmed block ${receipt.blockNumber} ✅`);
    await supabase.from('matches').update({ declare_tx: tx.hash }).eq('id', match.id);
    return true;
  } catch (err) {
    const msg = err.reason || err.message || String(err);
    console.error(`[${id}] Failed: ${msg}`);
    if (msg.includes('already') || msg.includes('0x7bfa4b9f')) {
      await supabase.from('matches').update({ declare_tx: 'already-declared' }).eq('id', match.id);
      return true;
    }
    return false;
  }
};

const run = async () => {
  console.log('=== FastFinger Winner Declarer (one-shot) ===');
  console.log(`Admin:  ${adminWallet.address}`);
  console.log(`Escrow: ${ESCROW_ADDRESS}`);

  const balance = await provider.getBalance(adminWallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  let processed = 0, failed = 0;

  // ── Step 1: settle rounds that have finished playing but have no winner yet.
  // This is the ONLY place winner_wallet ever gets written — computed here from
  // match_players, never trusted from anything the client sent.
  const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString();
  const { data: toSettle, error: settleErr } = await supabase
    .from('matches')
    .select('id, match_players(wallet_address, score, avg_reaction_time)')
    .eq('status', 'in_progress')
    .is('winner_wallet', null)
    .lte('game_start_time', cutoff);

  if (settleErr) { console.error('Supabase error (settle):', settleErr.message); process.exit(1); }

  for (const match of toSettle || []) {
    const id = match.id.slice(0, 8);
    const players = match.match_players || [];
    if (players.length === 0) { console.log(`[${id}] No players recorded, skipping`); continue; }

    const winner = pickWinner(players);
    console.log(`[${id}] Round over. Winner by score: ${winner.wallet_address} (${winner.score} pts)`);

    const { error: updErr } = await supabase.from('matches').update({
      winner_wallet: winner.wallet_address,
      status:        'finished',
      finished_at:   new Date().toISOString(),
    }).eq('id', match.id);

    if (updErr) { console.error(`[${id}] Failed to write winner:`, updErr.message); failed++; continue; }

    const ok = await declareOnChain({ id: match.id, winner_wallet: winner.wallet_address });
    ok ? processed++ : failed++;
  }

  // ── Step 2: anything already finished with a winner but no on-chain tx yet
  // (e.g. the process crashed between writing winner_wallet and declaring).
  const { data: pending, error: pendingErr } = await supabase
    .from('matches')
    .select('id, winner_wallet, match_players(wallet_address)')
    .eq('status', 'finished')
    .not('winner_wallet', 'is', null)
    .is('declare_tx', null);

  if (pendingErr) { console.error('Supabase error (pending):', pendingErr.message); process.exit(1); }

  for (const match of pending || []) {
    const id = match.id.slice(0, 8);
    const players = (match.match_players || []).map(p => p.wallet_address.toLowerCase());
    if (!players.includes(match.winner_wallet.toLowerCase())) {
      console.error(`[${id}] Winner not in player list — leaving for manual review`);
      continue;
    }
    const ok = await declareOnChain(match);
    ok ? processed++ : failed++;
  }

  console.log(`Done. Processed: ${processed}, Failed: ${failed}`);
  process.exit(processed === 0 && failed > 0 ? 1 : 0);
};

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
