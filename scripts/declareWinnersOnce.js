import 'dotenv/config';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const RPC_URL           = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ESCROW_ADDRESS    = process.env.ESCROW_CONTRACT_ADDRESS;
const ELIMINATION_ADDRESS = process.env.ELIMINATION_ESCROW_ADDRESS; // optional
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!ESCROW_ADDRESS)    { console.error('ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
if (!process.env.SUPABASE_URL) { console.error('SUPABASE_URL not set'); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }

const provider    = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
// Must use the SERVICE key here, not anon — only service_role can write
// winner_wallet/declare_tx/finalist_a/finalist_b/elim_third/runner_up (see
// supabase/migrations/00000000000000_init.sql and 20260924_elimination_mode.sql).
const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ESCROW_ABI = ['function declareWinner(bytes32 matchId, address winner) external'];
const ELIMINATION_ABI = ['function declareResults(bytes32 matchId, address first, address second, address third) external'];
const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet);
const eliminationContract = ELIMINATION_ADDRESS
  ? new ethers.Contract(ELIMINATION_ADDRESS, ELIMINATION_ABI, adminWallet)
  : null;

const uuidToBytes32 = (uuid) => '0x' + uuid.replace(/-/g, '').padEnd(64, '0');

// Must match src/lib/gameEngine.js ROUND_DURATION_SEC (60s) plus a buffer for
// score-sync lag over the network before we trust a match is really over.
const ROUND_DURATION_SEC = 60;
const SETTLE_BUFFER_SEC  = 15;
const ROUND_BREAK_SEC    = 60; // must match the frontend's round-break countdown

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
    if (match.mode === 'elimination') {
      if (!eliminationContract) { console.error(`[${id}] ELIMINATION_ESCROW_ADDRESS not set, skipping`); return false; }
      console.log(`[${id}] Declaring results: 1st ${match.winner_wallet}, 2nd ${match.runner_up}, 3rd ${match.elim_third}`);
      const tx = await eliminationContract.declareResults(
        uuidToBytes32(match.id), match.winner_wallet, match.runner_up, match.elim_third
      );
      console.log(`[${id}] TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`[${id}] Confirmed block ${receipt.blockNumber} ✅`);
      await supabase.from('matches').update({ declare_tx: tx.hash }).eq('id', match.id);
      return true;
    }
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
  console.log(`Standard escrow:    ${ESCROW_ADDRESS}`);
  console.log(`Elimination escrow: ${ELIMINATION_ADDRESS || '(not set)'}`);

  const balance = await provider.getBalance(adminWallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  let processed = 0, failed = 0;
  const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString();

  // ── Step 1a: settle standard matches ────────────────────────────────────
  {
    const { data: toSettle, error } = await supabase
      .from('matches')
      .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
      .eq('mode', 'standard')
      .eq('status', 'in_progress')
      .is('winner_wallet', null)
      .lte('game_start_time', cutoff);
    if (error) { console.error('Supabase error (settle standard):', error.message); process.exit(1); }

    for (const match of toSettle || []) {
      const id = match.id.slice(0, 8);
      const players = (match.match_players || []).filter(p => (p.round ?? 1) === 1);
      if (players.length === 0) { console.log(`[${id}] No players recorded, skipping`); continue; }
      const winner = pickWinner(players);
      console.log(`[${id}] Round over. Winner by score: ${winner.wallet_address} (${winner.score} pts)`);
      const { error: updErr } = await supabase.from('matches').update({
        winner_wallet: winner.wallet_address, status: 'finished', finished_at: new Date().toISOString(),
      }).eq('id', match.id);
      if (updErr) console.error(`[${id}] Failed to write winner:`, updErr.message);
    }
  }

  // ── Step 1b: settle elimination Round 1 ─────────────────────────────────
  {
    const { data: toSettle, error } = await supabase
      .from('matches')
      .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
      .eq('mode', 'elimination')
      .eq('round', 1)
      .is('finalist_a', null)
      .lte('game_start_time', cutoff);
    if (error) { console.error('Supabase error (settle elim r1):', error.message); process.exit(1); }

    for (const match of toSettle || []) {
      const id = match.id.slice(0, 8);
      const players = (match.match_players || []).filter(p => (p.round ?? 1) === 1);
      if (players.length < 3) { console.log(`[${id}] Fewer than 3 round-1 players, skipping`); continue; }
      const sorted = [...players].sort((a, b) =>
        b.score !== a.score ? b.score - a.score : (a.avg_reaction_time || 9999) - (b.avg_reaction_time || 9999)
      );
      const [finalistA, finalistB, thirdPlace] = sorted;
      console.log(`[${id}] Round 1 over. Advancing: ${finalistA.wallet_address}, ${finalistB.wallet_address}. 3rd: ${thirdPlace.wallet_address}`);
      const round2Start = new Date(Date.now() + ROUND_BREAK_SEC * 1000).toISOString();
      const { error: updErr } = await supabase.from('matches').update({
        finalist_a: finalistA.wallet_address,
        finalist_b: finalistB.wallet_address,
        elim_third: thirdPlace.wallet_address,
        round: 2,
        round2_start_time: round2Start,
      }).eq('id', match.id);
      if (updErr) console.error(`[${id}] Failed to write round-1 results:`, updErr.message);
    }
  }

  // ── Step 1c: settle elimination Round 2 ─────────────────────────────────
  {
    const { data: toSettle, error } = await supabase
      .from('matches')
      .select('id, finalist_a, finalist_b, match_players(wallet_address, score, avg_reaction_time, round)')
      .eq('mode', 'elimination')
      .eq('round', 2)
      .is('winner_wallet', null)
      .not('finalist_a', 'is', null)
      .lte('round2_start_time', cutoff);
    if (error) { console.error('Supabase error (settle elim r2):', error.message); process.exit(1); }

    for (const match of toSettle || []) {
      const id = match.id.slice(0, 8);
      const r2 = (match.match_players || []).filter(p => (p.round ?? 1) === 2);
      const scoreFor = (wallet) => r2.find(p => p.wallet_address === wallet) || { wallet_address: wallet, score: 0, avg_reaction_time: 9999 };
      const a = scoreFor(match.finalist_a);
      const b = scoreFor(match.finalist_b);
      const winner = pickWinner([a, b]);
      const runnerUp = winner.wallet_address === a.wallet_address ? b : a;
      console.log(`[${id}] Round 2 over. Winner: ${winner.wallet_address} (${winner.score} pts)`);
      const { error: updErr } = await supabase.from('matches').update({
        winner_wallet: winner.wallet_address, runner_up: runnerUp.wallet_address,
        status: 'finished', finished_at: new Date().toISOString(),
      }).eq('id', match.id);
      if (updErr) console.error(`[${id}] Failed to write round-2 results:`, updErr.message);
    }
  }

  // ── Step 2: declare on-chain whatever is settled but not yet declared ────
  {
    const { data: toDeclare, error } = await supabase
      .from('matches')
      .select('id, mode, winner_wallet, runner_up, elim_third, match_players(wallet_address)')
      .eq('status', 'finished')
      .not('winner_wallet', 'is', null)
      .is('declare_tx', null);
    if (error) { console.error('Supabase error (declare):', error.message); process.exit(1); }

    for (const match of toDeclare || []) {
      const id = match.id.slice(0, 8);
      const players = (match.match_players || []).map(p => p.wallet_address.toLowerCase());
      if (!players.includes(match.winner_wallet.toLowerCase())) {
        console.error(`[${id}] Winner not in player list — leaving for manual review`);
        continue;
      }
      if (match.mode === 'elimination' && (!match.runner_up || !match.elim_third)) {
        console.error(`[${id}] Missing runner_up/elim_third — leaving for manual review`);
        continue;
      }
      const ok = await declareOnChain(match);
      ok ? processed++ : failed++;
    }
  }

  console.log(`Done. Processed: ${processed}, Failed: ${failed}`);
  process.exit(processed === 0 && failed > 0 ? 1 : 0);
};

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
