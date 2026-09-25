import { useState, useEffect, useRef } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { subscribeToMatch, getMatchPlayers, startMatch, supabase } from '../lib/supabase';
import { formatWallet, getTierByIndex, cancelMatchOnChain } from '../lib/blockchain';
import { Loader, AlertCircle } from 'lucide-react';

export default function Matchmaking({ match, onGameStart, onLeave }) {
  const { address }            = useAccount();
  const { data: walletClient } = useWalletClient();

  const [players,     setPlayers]     = useState([]);
  const [matchData,   setMatchData]   = useState(match);
  const [cancelling,  setCancelling]  = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [displaySecs, setDisplaySecs] = useState(null);

  const launchedRef    = useRef(false);
  const startCalledRef = useRef(false);
  const playersRef     = useRef([]);
  const matchDataRef   = useRef(match);

  const tierInfo  = getTierByIndex(matchData.tier ?? 0);
  const pool      = parseFloat(matchData.prize_pool || 0);
  const isHost    = address === matchData.host_wallet;
  const remaining = matchData.max_players - players.length;
  const canCancel = isHost && players.length === 1 && matchData.status === 'waiting';

  const loadPlayers = async () => {
    const data = await getMatchPlayers(match.id);
    setPlayers(data);
    playersRef.current = data;
    return data;
  };

  // ─── Core launch function - fetches game_start_time fresh from DB ──────────
  const launchGame = async (knownStartTime) => {
    if (launchedRef.current) return;

    let startTimeStr = knownStartTime;

    // Always verify from DB - don't trust payload alone
    if (!startTimeStr) {
      const { data } = await supabase
        .from('matches')
        .select('game_start_time, status')
        .eq('id', match.id)
        .single();

      startTimeStr = data?.game_start_time;
      console.log('[Matchmaking] Fetched from DB:', data);
    }

    if (!startTimeStr) {
      // game_start_time still null - startMatch hasn't written it yet
      // Poll again in 500ms
      console.warn('[Matchmaking] game_start_time not ready, retrying in 500ms...');
      setTimeout(() => launchGame(null), 500);
      return;
    }

    launchedRef.current = true;

    const startAt = new Date(startTimeStr).getTime();
    const delay   = Math.max(0, startAt - Date.now());

    console.log(`[Matchmaking] Launching in ${delay}ms`);

    // Show countdown
    setDisplaySecs(Math.ceil(delay / 1000));
    const interval = setInterval(() => {
      const secs = Math.ceil((startAt - Date.now()) / 1000);
      if (secs <= 0) { clearInterval(interval); setDisplaySecs(0); }
      else setDisplaySecs(secs);
    }, 250);

    setTimeout(() => {
      clearInterval(interval);
      onGameStart(
        { ...matchDataRef.current, game_start_time: startTimeStr },
        playersRef.current
      );
    }, delay);
  };

  useEffect(() => {
    // Keep refs in sync
    matchDataRef.current = matchData;
  }, [matchData]);

  useEffect(() => {
    loadPlayers().then(fresh => {
      // Handle rejoin: match already started
      if (['starting', 'in_progress'].includes(match.status) && !launchedRef.current) {
        launchGame(match.game_start_time || null);
      }
    });

    const channel = subscribeToMatch(match.id, async (payload) => {
      const fresh = await loadPlayers();
      if (!payload.new) return;

      const updated = { ...matchDataRef.current, ...payload.new };
      setMatchData(updated);
      matchDataRef.current = updated;

      const newStatus = payload.new.status;
      console.log('[Matchmaking] realtime status:', newStatus, 'game_start_time:', payload.new.game_start_time);

      // Trigger on starting OR in_progress
      if (['starting', 'in_progress'].includes(newStatus) && !launchedRef.current) {
        await launchGame(payload.new.game_start_time || null);
      }
    });

    return () => { channel.unsubscribe(); };
  }, [match.id]);

  // ─── Host fires startMatch when pool is full ───────────────────────────────
  // Runs whenever players.length changes
  useEffect(() => {
    if (players.length === 0) return;
    if (startCalledRef.current) return;
    if (launchedRef.current) return;
    if (players.length < matchData.max_players) return;
    if (!isHost) return;

    // Host calls startMatch regardless of current status (waiting or starting)
    // because joinMatch sets status to 'starting' when last player joins
    console.log('[Matchmaking] Pool full, host calling startMatch...');
    startCalledRef.current = true;

    startMatch(match.id)
      .then(gameStartTime => {
        console.log('[Matchmaking] startMatch OK, game_start_time:', gameStartTime);
        // Host also launches via the realtime event, but as safety fallback:
        setTimeout(() => launchGame(gameStartTime), 200);
      })
      .catch(err => {
        console.error('[Matchmaking] startMatch failed:', err);
        startCalledRef.current = false;
      });
  }, [players.length]);

  const handleCancel = async () => {
    if (!walletClient || !canCancel) return;
    setCancelError('');
    setCancelling(true);
    try {
      const result = await cancelMatchOnChain(walletClient, match.id, match.mode || 'standard');
      if (!result.success) {
        setCancelError(result.error || 'Cancellation failed.');
        setCancelling(false);
        return;
      }
      await supabase.from('matches').update({ status: 'cancelled', prize_claimed: true }).eq('id', match.id);
      onLeave();
    } catch (err) {
      setCancelError(err.message);
      setCancelling(false);
    }
  };

  return (
    <div className="matchmaking">
      <div className="matchmaking-card">
        <div className="matchmaking-header">
          <div className="mm-tier-badge" style={{ color: 'var(--primary-glow)' }}>
            {tierInfo.icon} {tierInfo.rf} RF Pool
            {matchData.mode === 'elimination' && (
              <span style={{ marginLeft: '8px', fontSize: '11px', background: 'rgba(204,255,0,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                Elimination
              </span>
            )}
          </div>
          <h2>Waiting for Players</h2>
          <div className="match-id">Match #{match.id.slice(0, 8)}</div>
        </div>

        <div className="player-count-ring">
          <div className="ring-inner">
            <span className="ring-number">{players.length}</span>
            <span className="ring-label">/ {matchData.max_players}</span>
          </div>
        </div>

        <div className="mm-slots-info">
          <span className="slots-joined">{players.length} joined</span>
          <span className="slots-remaining">
            {remaining > 0 ? `${remaining} more needed` : 'Pool is full!'}
          </span>
        </div>

        <div className="prize-display">
          <span className="prize-label">Prize Pool</span>
          <span className="prize-amount">🏆 {pool.toLocaleString()} RF</span>
        </div>

        <div className="players-list">
          {players.map((p, i) => (
            <div key={p.id} className="player-item">
              <span className="player-num">#{i + 1}</span>
              <span className="player-wallet">
                {formatWallet(p.wallet_address)}
                {p.wallet_address === matchData.host_wallet && <span className="host-badge">HOST</span>}
                {p.wallet_address === address && <span className="you-badge">YOU</span>}
              </span>
              <span className="player-ready">✓</span>
            </div>
          ))}
          {Array.from({ length: Math.max(0, remaining) }).map((_, i) => (
            <div key={`empty-${i}`} className="player-item empty">
              <span className="player-num">#{players.length + i + 1}</span>
              <span className="player-wallet">Waiting for player...</span>
              <Loader size={14} className="spinning" />
            </div>
          ))}
        </div>

        {displaySecs !== null && (
          <div className="countdown">
            <div className="countdown-number">{displaySecs > 0 ? displaySecs : '⚡'}</div>
            <div className="countdown-label">
              {displaySecs > 0 ? 'Game starting for all players...' : 'Launching now!'}
            </div>
          </div>
        )}

        {cancelError && (
          <div className="lobby-error" style={{ margin: '0.75rem 0' }}>
            <AlertCircle size={14} /> {cancelError}
          </div>
        )}

        <div className="matchmaking-actions">
          {canCancel && (
            <>
              <button className="cancel-refund-btn" onClick={handleCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling...' : '↩ Cancel & Get Refund'}
              </button>
              <p className="cancel-hint">
                No one has joined yet. Cancel to get your {tierInfo.rf} RF back.
              </p>
            </>
          )}
          {!canCancel && remaining > 0 && !isHost && (
            <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Waiting for {remaining} more player{remaining !== 1 ? 's' : ''}...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
