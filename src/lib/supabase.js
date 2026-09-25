import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      || 'https://nwxkeswqiorspldaqycl.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});

// ─── Realtime ─────────────────────────────────────────────────────────────────

export const subscribeToMatch = (matchId, onUpdate) => {
  return supabase
    .channel(`match-${matchId}-${Date.now()}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'match_players',
      filter: `match_id=eq.${matchId}`,
    }, onUpdate)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'matches',
      filter: `id=eq.${matchId}`,
    }, onUpdate)
    .subscribe();
};

export const subscribeToLobby = (onUpdate) => {
  return supabase
    .channel(`lobby-${Date.now()}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'matches',
    }, onUpdate)
    .subscribe();
};

// ─── Match Operations ─────────────────────────────────────────────────────────

export const createMatch = async (walletAddress, entryEth, maxPlayers, tier, matchIdOverride, mode = 'standard') => {
  const { data, error } = await supabase
    .from('matches')
    .insert({
      id:              matchIdOverride,
      host_wallet:     walletAddress,
      entry_fee:       entryEth,
      max_players:     maxPlayers,
      prize_pool:      entryEth,
      current_players: 1,
      tier:            tier,
      status:          'waiting',
      mode,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from('match_players').insert({
    match_id:       data.id,
    wallet_address: walletAddress,
    score:          0,
    status:         'joined',
    round:          1,
  });
  return data;
};

export const joinMatch = async (matchId, walletAddress) => {
  const { data: existing } = await supabase
    .from('match_players')
    .select('id')
    .eq('match_id', matchId)
    .eq('wallet_address', walletAddress)
    .maybeSingle();
  if (existing) return existing;

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('entry_fee, prize_pool, current_players, max_players, status')
    .eq('id', matchId)
    .single();
  if (matchErr) throw matchErr;
  if (!match) throw new Error('Match not found');
  if (!['waiting', 'starting'].includes(match.status)) throw new Error('Match is no longer open');
  if (match.current_players >= match.max_players) throw new Error('Match is already full');

  const { data, error } = await supabase
    .from('match_players')
    .insert({ match_id: matchId, wallet_address: walletAddress, score: 0, status: 'joined', round: 1 })
    .select()
    .single();
  if (error) throw error;

  const newCount = match.current_players + 1;
  const newPrize = (parseFloat(match.prize_pool) + parseFloat(match.entry_fee)).toFixed(6);
  const updates  = { prize_pool: newPrize, current_players: newCount };
  if (newCount === match.max_players) updates.status = 'starting';
  await supabase.from('matches').update(updates).eq('id', matchId);
  return data;
};

export const getOpenMatches = async () => {
  const { data, error } = await supabase
    .from('matches')
    .select('*, match_players(*)')
    .in('status', ['waiting', 'starting'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getOpenMatches error:', error);
    return [];
  }

  console.log('getOpenMatches raw:', data?.length, 'matches', data?.map(m => ({
    id: m.id.slice(0, 8),
    status: m.status,
    players: m.match_players?.length,
    max: m.max_players,
    age_hours: ((Date.now() - new Date(m.created_at).getTime()) / 3600000).toFixed(1),
  })));

  // Filter: not full (use actual player count from match_players join)
  // Age limit: 7 days (604800000 ms) — generous so old matches don't disappear
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const now        = Date.now();

  return (data || []).filter(m => {
    const age        = now - new Date(m.created_at).getTime();
    const realCount  = m.match_players?.length ?? m.current_players ?? 0;
    const isFull     = realCount >= m.max_players;
    const tooOld     = age > SEVEN_DAYS;
    return !isFull && !tooOld;
  });
};

export const getMyActiveMatch = async (walletAddress) => {
  const { data } = await supabase
    .from('match_players')
    .select('match_id')
    .eq('wallet_address', walletAddress);
  if (!data?.length) return null;
  const ids = data.map(r => r.match_id);
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .in('id', ids)
    .in('status', ['waiting', 'starting', 'in_progress'])
    .order('created_at', { ascending: false });

  // An elimination match past round 1 is only still "active" for this wallet
  // if they're one of the two finalists — everyone else is fully done, even
  // though the match itself is still technically in_progress for the finalists.
  const stillActive = (matches || []).find(m => {
    if (m.mode !== 'elimination') return true;
    if (!m.finalist_a) return true; // round 1 hasn't settled yet, everyone's still in
    return m.finalist_a === walletAddress || m.finalist_b === walletAddress;
  });
  return stillActive || null;
};

export const cancelMatch = async (matchId) => {
  await supabase.from('matches')
    .update({ status: 'cancelled', prize_claimed: true })
    .eq('id', matchId);
};

export const startMatch = async (matchId) => {
  const gameStartTime = new Date(Date.now() + 4000).toISOString();
  const { error } = await supabase.from('matches').update({
    status:          'in_progress',
    started_at:      new Date().toISOString(),
    game_start_time: gameStartTime,
  }).eq('id', matchId);
  if (error) throw error;
  return gameStartTime;
};

export const getMatch = async (matchId) => {
  const { data, error } = await supabase
    .from('matches')
    .select('*, match_players(*)')
    .eq('id', matchId)
    .single();
  if (error) return null;
  return data;
};

export const getMatchPlayers = async (matchId, round = null) => {
  let query = supabase.from('match_players').select('*').eq('match_id', matchId);
  if (round !== null) query = query.eq('round', round);
  const { data, error } = await query.order('score', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Elimination round 2 has no pre-existing row for the two finalists (only
// round 1 got one at join time), so this upserts on the real unique key
// (match_id, wallet_address, round) instead of assuming an update will match.
export const updatePlayerScore = async (matchId, walletAddress, score, reactionTime, status = 'playing', round = 1) => {
  await supabase.from('match_players')
    .upsert(
      { match_id: matchId, wallet_address: walletAddress, score, avg_reaction_time: reactionTime, status, round },
      { onConflict: 'match_id,wallet_address,round' }
    );
};

// Winner determination moved server-side (scripts/declareWinnersOnce.js), which
// is the only thing with permission to write winner_wallet/declare_tx — see
// migration 00000000000000_init.sql. The client only ever reports its own
// score and waits for the backend to fill in the result.

export const getClaimableWins = async (walletAddress) => {
  const { data, error } = await supabase.from('matches').select('*')
    .eq('mode', 'standard')
    .eq('winner_wallet', walletAddress)
    .eq('status', 'finished')
    .eq('prize_claimed', false)
    .order('finished_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Elimination mode has three independent claimants, so there's no single
// prize_claimed boolean per match — whether *this* wallet has already claimed
// their specific share is checked on-chain instead (see
// checkEliminationClaimed in blockchain.js), which can never drift from
// what actually happened the way a Supabase flag could.
export const getClaimableEliminationMatches = async (walletAddress) => {
  const { data, error } = await supabase.from('matches').select('*')
    .eq('mode', 'elimination')
    .eq('status', 'finished')
    .or(`winner_wallet.eq.${walletAddress},runner_up.eq.${walletAddress},elim_third.eq.${walletAddress}`)
    .order('finished_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const markPrizeClaimed = async (matchId, txId) => {
  await supabase.from('matches')
    .update({ prize_claimed: true, claim_tx: txId })
    .eq('id', matchId);
};

export const recordGameResult = async (walletAddress, won) => {
  const { data: ex } = await supabase.from('leaderboard').select('*')
    .eq('wallet_address', walletAddress).maybeSingle();
  if (ex) {
    await supabase.from('leaderboard').update({
      total_games: ex.total_games + 1,
      total_wins:  won ? ex.total_wins + 1 : ex.total_wins,
    }).eq('wallet_address', walletAddress);
  } else {
    await supabase.from('leaderboard').insert({
      wallet_address: walletAddress, total_games: 1,
      total_wins: won ? 1 : 0, total_rf_won: 0,
    });
  }
};

export const recordRfWin = async (walletAddress, rfAmount) => {
  const { data: ex } = await supabase.from('leaderboard')
    .select('total_rf_won').eq('wallet_address', walletAddress).maybeSingle();
  if (ex) {
    await supabase.from('leaderboard').update({
      total_rf_won: (parseFloat(ex.total_rf_won || 0) + parseFloat(rfAmount)).toFixed(4),
    }).eq('wallet_address', walletAddress);
  } else {
    await supabase.from('leaderboard').insert({
      wallet_address: walletAddress, total_games: 0, total_wins: 0,
      total_rf_won: parseFloat(rfAmount).toFixed(4),
    });
  }
};

export const getLeaderboard = async () => {
  const { data, error } = await supabase.from('leaderboard').select('*')
    .order('total_rf_won', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
};

// ─── Seasonal prize pool ──────────────────────────────────────────────────────
// Funded and paid out manually by the project owner — this is tracking and
// display only. No RF moves through any of these functions.

export const getCurrentSeason = async () => {
  const { data, error } = await supabase.from('seasons')
    .select('*').eq('is_active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
};

export const createSeason = async (startsAt, endsAt, poolWallet) => {
  // Only one active season at a time — close out any currently active one.
  await supabase.from('seasons').update({ is_active: false }).eq('is_active', true);
  const { data, error } = await supabase.from('seasons')
    .insert({ starts_at: startsAt, ends_at: endsAt, pool_wallet: poolWallet, is_active: true })
    .select().single();
  if (error) throw error;
  return data;
};

// Cumulative in-game score per wallet across every match that finished inside
// the season window — not RF won, not wins, the raw score total.
export const getSeasonLeaderboard = async (startsAt, endsAt, limit = 5) => {
  const { data, error } = await supabase
    .from('match_players')
    .select('wallet_address, score, matches!inner(finished_at)')
    .gte('matches.finished_at', startsAt)
    .lte('matches.finished_at', endsAt);
  if (error) throw error;

  const totals = new Map();
  for (const row of data || []) {
    totals.set(row.wallet_address, (totals.get(row.wallet_address) || 0) + (row.score || 0));
  }
  return [...totals.entries()]
    .map(([wallet_address, points]) => ({ wallet_address, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
};

export const getSeasonPayouts = async (seasonId) => {
  const { data, error } = await supabase.from('season_payouts')
    .select('*').eq('season_id', seasonId).order('rank', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const recordSeasonPayout = async (seasonId, rank, walletAddress, amount, txHash) => {
  const { error } = await supabase.from('season_payouts')
    .insert({ season_id: seasonId, rank, wallet_address: walletAddress, amount, tx_hash: txHash || null });
  if (error) throw error;
};
