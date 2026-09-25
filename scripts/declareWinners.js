import 'dotenv/config';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

// ─── Config ──────────────────────────────────────────────────────────────────
const RPC_URL = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
const ELIMINATION_ADDRESS = process.env.ELIMINATION_ESCROW_ADDRESS; // optional - elimination mode just won't settle without it
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!ESCROW_ADDRESS)    { console.error('❌ ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!ADMIN_PRIVATE_KEY) { console.error('❌ ADMIN_PRIVATE_KEY not set'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

// Must use the SERVICE key here, not anon - only service_role can write
// winner_wallet/declare_tx/finalist_a/finalist_b/elim_third/runner_up (see
// supabase/migrations/00000000000000_init.sql and 20260924_elimination_mode.sql).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ESCROW_ABI = [
  'function declareWinner(bytes32 matchId, address winner) external',
];
const ELIMINATION_ABI = [
  'function declareResults(bytes32 matchId, address first, address second, address third) external',
];

const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet);
const eliminationContract = ELIMINATION_ADDRESS
  ? new ethers.Contract(ELIMINATION_ADDRESS, ELIMINATION_ABI, adminWallet)
  : null;

// Must match src/lib/gameEngine.js ROUND_DURATION_SEC (60s) plus a buffer for
// score-sync lag over the network before we trust a match is really over.
const ROUND_DURATION_SEC = 60;
const SETTLE_BUFFER_SEC  = 15;
// Gap between round 1 ending and round 2 starting, shown to players as a
// countdown - must match the frontend's own round-break timer.
const ROUND_BREAK_SEC = 60;

// ─── Helpers ────────────────────────────────────────────────────────────────
const uuidToBytes32 = (uuid) => {
  const hex = uuid.replace(/-/g, '');
  return '0x' + hex.padEnd(64, '0');
};

/// @dev The only place a winner is ever decided. Never trust a client-supplied
/// winner_wallet - recompute from match_players every time, same tie-break as
/// the client UI uses for display (highest score, then lowest avg reaction time).
const pickWinner = (players) => {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top    = sorted[0]?.score ?? 0;
  const tied   = sorted.filter(p => p.score === top);
  return tied.length === 1
    ? tied[0]
    : tied.sort((a, b) => (a.avg_reaction_time || 9999) - (b.avg_reaction_time || 9999))[0];
};

// ─── Declare Winner (standard mode - one winner, whole pot) ──────────────────
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
    const msg = err.reason || err.message || String(err);
    console.error(`   ❌ declareWinner failed:`, msg);
    if (msg.includes('already') || msg.includes('0x7bfa4b9f')) return 'already-declared';
    throw err;
  }
};

// ─── Declare Results (elimination mode - three placements share the pot) ─────
const declareResultsOnChain = async (matchId, first, second, third) => {
  if (!eliminationContract) throw new Error('ELIMINATION_ESCROW_ADDRESS not set - cannot declare elimination results');
  const matchIdBytes32 = uuidToBytes32(matchId);

  console.log(`\n🏆 Declaring results for elimination match ${matchId.slice(0,8)}...`);
  console.log(`   1st: ${first}  2nd: ${second}  3rd: ${third}`);

  try {
    const tx = await eliminationContract.declareResults(matchIdBytes32, first, second, third);
    console.log(`   TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

    return tx.hash;
  } catch (err) {
    const msg = err.reason || err.message || String(err);
    console.error(`   ❌ declareResults failed:`, msg);
    if (msg.includes('already') || msg.includes('0x7bfa4b9f')) return 'already-declared';
    throw err;
  }
};

// ─── Settle standard matches that finished playing but have no winner yet ────
const settleStandardRounds = async () => {
  const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString();
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
    .eq('mode', 'standard')
    .eq('status', 'in_progress')
    .is('winner_wallet', null)
    .lte('game_start_time', cutoff);

  if (error) { console.error('Supabase error (settle standard):', error.message); return; }
  if (!matches?.length) return;

  for (const match of matches) {
    const id = match.id.slice(0, 8);
    const players = (match.match_players || []).filter(p => p.round === 1);
    if (players.length === 0) { console.log(`   [${id}] No players recorded, skipping`); continue; }

    const winner = pickWinner(players);
    console.log(`   [${id}] Round over. Winner by score: ${winner.wallet_address} (${winner.score} pts)`);

    const { error: updErr } = await supabase.from('matches').update({
      winner_wallet: winner.wallet_address,
      status:        'finished',
      finished_at:   new Date().toISOString(),
    }).eq('id', match.id);

    if (updErr) console.error(`   [${id}] Failed to write winner:`, updErr.message);
  }
};

// ─── Settle elimination Round 1: narrow the field to a top 2 + a 3rd place ───
const settleEliminationRound1 = async () => {
  const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString();
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
    .eq('mode', 'elimination')
    .eq('round', 1)
    .is('finalist_a', null)
    .lte('game_start_time', cutoff);

  if (error) { console.error('Supabase error (settle elim r1):', error.message); return; }
  if (!matches?.length) return;

  for (const match of matches) {
    const id = match.id.slice(0, 8);
    const players = (match.match_players || []).filter(p => p.round === 1);
    if (players.length < 3) { console.log(`   [${id}] Fewer than 3 round-1 players recorded, skipping`); continue; }

    const sorted = [...players].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.avg_reaction_time || 9999) - (b.avg_reaction_time || 9999);
    });
    const [finalistA, finalistB, thirdPlace] = sorted;

    console.log(`   [${id}] Round 1 over. Advancing: ${finalistA.wallet_address}, ${finalistB.wallet_address}. 3rd: ${thirdPlace.wallet_address}`);

    const round2Start = new Date(Date.now() + ROUND_BREAK_SEC * 1000).toISOString();
    const { error: updErr } = await supabase.from('matches').update({
      finalist_a:        finalistA.wallet_address,
      finalist_b:        finalistB.wallet_address,
      elim_third:        thirdPlace.wallet_address,
      round:             2,
      round2_start_time: round2Start,
    }).eq('id', match.id);

    if (updErr) console.error(`   [${id}] Failed to write round-1 results:`, updErr.message);
  }
};

// ─── Settle elimination Round 2: the final head-to-head ──────────────────────
const settleEliminationRound2 = async () => {
  const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString();
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, finalist_a, finalist_b, elim_third, match_players(wallet_address, score, avg_reaction_time, round)')
    .eq('mode', 'elimination')
    .eq('round', 2)
    .is('winner_wallet', null)
    .not('finalist_a', 'is', null)
    .lte('round2_start_time', cutoff);

  if (error) { console.error('Supabase error (settle elim r2):', error.message); return; }
  if (!matches?.length) return;

  for (const match of matches) {
    const id = match.id.slice(0, 8);
    const r2Players = (match.match_players || []).filter(p => p.round === 2);

    // A finalist who never played round 2 defaults to a 0-score no-show  - 
    // still gets 2nd place and can still claim, they just didn't show up.
    const scoreFor = (wallet) => r2Players.find(p => p.wallet_address === wallet) || { wallet_address: wallet, score: 0, avg_reaction_time: 9999 };
    const a = scoreFor(match.finalist_a);
    const b = scoreFor(match.finalist_b);
    const winner = pickWinner([a, b]);
    const runnerUp = winner.wallet_address === a.wallet_address ? b : a;

    console.log(`   [${id}] Round 2 over. Winner: ${winner.wallet_address} (${winner.score} pts)`);

    const { error: updErr } = await supabase.from('matches').update({
      winner_wallet: winner.wallet_address,
      runner_up:     runnerUp.wallet_address,
      status:        'finished',
      finished_at:   new Date().toISOString(),
    }).eq('id', match.id);

    if (updErr) console.error(`   [${id}] Failed to write round-2 results:`, updErr.message);
  }
};

// ─── Main Processor ─────────────────────────────────────────────────────────
const processFinishedMatches = async () => {
  console.log('\n⏱  Checking for rounds ready to settle...');
  await settleStandardRounds();
  await settleEliminationRound1();
  await settleEliminationRound2();

  console.log('\n🔍 Checking for finished matches to declare on-chain...');

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
      const players = match.match_players ? match.match_players.map(p => p.wallet_address.toLowerCase()) : [];
      if (!players.includes(match.winner_wallet.toLowerCase())) {
        console.error(`   ❌ Winner ${match.winner_wallet} not in player list for match ${match.id}`);
        continue;
      }

      let txHash;
      if (match.mode === 'elimination') {
        if (!match.runner_up || !match.elim_third) {
          console.error(`   ❌ Elimination match ${match.id} missing runner_up/elim_third - skipping`);
          continue;
        }
        txHash = await declareResultsOnChain(match.id, match.winner_wallet, match.runner_up, match.elim_third);
      } else {
        txHash = await declareWinnerOnChain(match.id, match.winner_wallet);
      }

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
  console.log(`   Standard escrow: ${ESCROW_ADDRESS}`);
  console.log(`   Elimination escrow: ${ELIMINATION_ADDRESS || '(not set - elimination matches will not settle)'}`);

  await processFinishedMatches();
  setInterval(processFinishedMatches, 15000); // every 15 seconds
};

start().catch(console.error);
