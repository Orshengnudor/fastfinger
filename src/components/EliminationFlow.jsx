import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { updatePlayerScore, subscribeToMatch, getMatchPlayers, supabase } from '../lib/supabase';
import { formatWallet } from '../lib/blockchain';
import {
  createGameState, spawnTarget, hitTarget, removeExpiredTargets,
  getRandomSpawnInterval, calculateAccuracy, getAvgReactionTime, ROUND_DURATION_SEC,
} from '../lib/gameEngine';
import { Zap, Target, Clock, Skull, Trophy } from 'lucide-react';

const AREA_WIDTH  = 320;
const AREA_HEIGHT = 384;

export default function EliminationFlow({ match, players: initialPlayers, onGameEnd }) {
  const { address } = useAccount();

  const [stage,         setStage]         = useState('init'); // see state machine below
  const [gameState,     setGameState]     = useState(() => createGameState());
  const [opponents,     setOpponents]     = useState(initialPlayers || []);
  const [lastHitEffect, setLastHitEffect] = useState(null);
  const [countdownNum,  setCountdownNum]  = useState(null);
  const [matchRow,      setMatchRow]      = useState(match);
  const [myR1Placement, setMyR1Placement] = useState(null); // for the eliminated screen

  const spawnRef      = useRef(null);
  const cleanupRef    = useRef(null);
  const tickRef       = useRef(null);
  const gsRef         = useRef(gameState);
  const doneRef       = useRef(false);
  const gameEndAtRef  = useRef(null);
  const matchRowRef   = useRef(match);
  gsRef.current       = gameState;
  matchRowRef.current = matchRow;

  const isFinalist = matchRow.finalist_a === address || matchRow.finalist_b === address;
  const currentRound = stage.startsWith('r2') ? 2 : 1;

  // ─── Figure out where to resume - critical for rejoining mid-match ─────────
  useEffect(() => {
    (async () => {
      const { data: fresh } = await supabase.from('matches').select('*').eq('id', match.id).single();
      const m = fresh || match;
      setMatchRow(m);
      matchRowRef.current = m;

      if (m.winner_wallet) { setStage('final'); return; }

      if (m.round === 2 && m.finalist_a) {
        if (m.finalist_a !== address && m.finalist_b !== address) {
          // Not a finalist - done. The effect below hands off to GameResults.
          const all = await getMatchPlayers(match.id, 1);
          const sorted = [...all].sort((a, b) => b.score - a.score);
          setMyR1Placement(sorted.findIndex(p => p.wallet_address === address) + 1);
          setStage('eliminated');
          return;
        }
        // A finalist - either waiting for round 2 to start or already playing it.
        const startAt = m.round2_start_time ? new Date(m.round2_start_time).getTime() : Date.now();
        if (Date.now() >= startAt) beginRound(2, m, startAt);
        else scheduleRoundStart(2, m, startAt);
        return;
      }

      // Still round 1.
      const startAt = m.game_start_time ? new Date(m.game_start_time).getTime() : Date.now();
      if (Date.now() >= startAt) beginRound(1, m, startAt);
      else scheduleRoundStart(1, m, startAt);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once elimination is determined, hand off to GameResults immediately  - 
  // no separate terminal screen here, one unified results screen for every
  // outcome (1st/2nd/3rd/eliminated).
  useEffect(() => {
    if (stage !== 'eliminated' || myR1Placement === null) return;
    onGameEnd({
      mode: 'elimination',
      place: myR1Placement === 3 ? 3 : null,
      eliminated: true,
      score: gsRef.current.score,
      prizePool: match.prize_pool || 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, myR1Placement]);

  // ─── Live opponent scores + realtime match updates (round-1 settle, etc.) ──
  useEffect(() => {
    const ch = subscribeToMatch(match.id, async (payload) => {
      const data = await getMatchPlayers(match.id, currentRound);
      setOpponents(data);
      if (payload.new) {
        const updated = { ...matchRowRef.current, ...payload.new };
        setMatchRow(updated);
        matchRowRef.current = updated;
      }
    });
    return () => ch.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, currentRound]);

  const scheduleRoundStart = (round, m, startAt) => {
    setStage(round === 1 ? 'r1-countdown' : 'r2-countdown');
    const msUntilStart = startAt - Date.now();
    setCountdownNum(Math.ceil(msUntilStart / 1000));
    const interval = setInterval(() => {
      setCountdownNum(Math.max(0, Math.ceil((startAt - Date.now()) / 1000)));
    }, 250);
    setTimeout(() => { clearInterval(interval); beginRound(round, matchRowRef.current, startAt); }, Math.max(0, msUntilStart));
  };

  const beginRound = (round, m, startAt) => {
    const endAt = startAt + ROUND_DURATION_SEC * 1000;
    gameEndAtRef.current = endAt;
    const remainingSec = Math.max(1, Math.round((endAt - Date.now()) / 1000));
    doneRef.current = false;
    setGameState(createGameState());
    setCountdownNum(null);
    setStage(round === 1 ? 'r1-playing' : 'r2-playing');
    setGameState(prev => ({ ...prev, isActive: true, timeLeft: remainingSec }));
  };

  // ─── Shared playing-loop: timer, spawner, cleanup - same for both rounds ───
  const playing = stage === 'r1-playing' || stage === 'r2-playing';

  useEffect(() => {
    if (!playing) return;
    tickRef.current = setInterval(() => {
      setGameState(prev => {
        const msLeft = gameEndAtRef.current - Date.now();
        const secsLeft = Math.max(0, Math.round(msLeft / 1000));
        if (secsLeft <= 0) {
          clearInterval(tickRef.current);
          clearTimeout(spawnRef.current);
          clearInterval(cleanupRef.current);
          const final = { ...prev, timeLeft: 0, isActive: false };
          if (!doneRef.current) {
            doneRef.current = true;
            setStage(s => (s === 'r1-playing' ? 'r1-waiting' : 'r2-waiting'));
            setTimeout(() => handleRoundOver(final), 500);
          }
          return final;
        }
        return { ...prev, timeLeft: secsLeft };
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const schedule = () => {
      spawnRef.current = setTimeout(() => {
        setGameState(prev => {
          if (!prev.isActive) return prev;
          const t = spawnTarget(prev, AREA_WIDTH, AREA_HEIGHT);
          return t ? { ...prev, targets: [...prev.targets, t] } : prev;
        });
        if (gsRef.current.isActive) schedule();
      }, getRandomSpawnInterval(gsRef.current.timeLeft));
    };
    schedule();
    return () => clearTimeout(spawnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    cleanupRef.current = setInterval(() => setGameState(prev => removeExpiredTargets({ ...prev })), 150);
    return () => clearInterval(cleanupRef.current);
  }, [playing]);

  useEffect(() => {
    if (!playing || !address) return;
    const sync = setInterval(() => {
      const gs = gsRef.current;
      updatePlayerScore(match.id, address, gs.score, getAvgReactionTime(gs), 'playing', currentRound);
    }, 1500);
    return () => clearInterval(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, address, match.id, currentRound]);

  const handleTargetClick = useCallback((targetId) => {
    setGameState(prev => {
      const next = hitTarget({ ...prev, targets: [...prev.targets] }, targetId);
      if (next.lastHit) {
        setLastHitEffect(next.lastHit);
        setTimeout(() => setLastHitEffect(null), 600);
      }
      return next;
    });
  }, []);

  // ─── End of a round ─────────────────────────────────────────────────────────
  const handleRoundOver = async (finalState) => {
    if (!address) return;
    while (true) {
      try {
        await updatePlayerScore(match.id, address, finalState.score, getAvgReactionTime(finalState), 'done', currentRound);
        break;
      } catch (err) {
        console.error('Failed to submit final score, retrying:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (currentRound === 1) {
      // Poll until the backend settles round 1 (finalist_a gets set either way).
      let settled = null;
      while (!settled) {
        try {
          const { data } = await supabase.from('matches').select('*').eq('id', match.id).maybeSingle();
          if (data?.finalist_a) { settled = data; break; }
        } catch (err) {
          console.error('Failed to poll for round-1 settlement, retrying:', err);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      setMatchRow(settled);
      matchRowRef.current = settled;

      if (settled.finalist_a !== address && settled.finalist_b !== address) {
        const all = await getMatchPlayers(match.id, 1);
        const sorted = [...all].sort((a, b) => b.score - a.score);
        setMyR1Placement(sorted.findIndex(p => p.wallet_address === address) + 1);
        setStage('eliminated');
        return;
      }
      // Advanced - show the "you're in the final" screen then start round 2.
      const startAt = new Date(settled.round2_start_time).getTime();
      scheduleRoundStart(2, settled, startAt);
      return;
    }

    // Round 2 over - poll for the final on-chain-ready result.
    let settled = null;
    while (!settled) {
      try {
        const { data } = await supabase.from('matches').select('*').eq('id', match.id).maybeSingle();
        if (data?.winner_wallet) { settled = data; break; }
      } catch (err) {
        console.error('Failed to poll for final result, retrying:', err);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    setMatchRow(settled);
    finishUp(settled, finalState);
  };

  const finishUp = async (settled, finalState) => {
    const r1 = await getMatchPlayers(match.id, 1);
    const r2 = await getMatchPlayers(match.id, 2);
    const place =
      settled.winner_wallet === address ? 1 :
      settled.runner_up === address ? 2 :
      settled.elim_third === address ? 3 : null;

    onGameEnd({
      ...finalState,
      mode: 'elimination',
      place,
      winner: settled.winner_wallet,
      runnerUp: settled.runner_up,
      third: settled.elim_third,
      round1Players: [...r1].sort((a, b) => b.score - a.score),
      round2Players: [...r2].sort((a, b) => b.score - a.score),
      prizePool: match.prize_pool || 0,
      perfectHits: finalState.perfectHits,
      maxCombo: finalState.maxCombo,
    });
  };

  // Brief transitional frame - the effect above already calls onGameEnd the
  // moment elimination is detected, so this shows for a beat at most.
  if (stage === 'eliminated') {
    return (
      <div className="game-results">
        <div className="results-card" style={{ textAlign: 'center' }}>
          <Skull size={48} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
          <h1>Eliminated</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            You placed #{myR1Placement} in Round 1. The top 2 advanced to the final.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gameplay">
      <div className="game-hud">
        <div className="hud-item score"><Zap size={16} /><span>{gameState.score}</span></div>
        <div className="hud-item timer">
          <Clock size={16} />
          <span className={gameState.timeLeft <= 10 ? 'urgent' : ''}>{gameState.timeLeft ?? ROUND_DURATION_SEC}s</span>
        </div>
        <div className="hud-item combo"><Target size={16} /><span>x{gameState.combo}</span></div>
        <div className="hud-item" style={{ fontSize: '0.75rem', opacity: 0.7 }}>Round {currentRound}/2</div>
      </div>

      <div className="opponents-bar">
        {opponents.filter(p => p.wallet_address !== address).map(p => (
          <div key={p.id} className="opponent-score">
            <span className="opp-name">{formatWallet(p.wallet_address)}</span>
            <span className="opp-score">{p.score || 0}</span>
          </div>
        ))}
      </div>

      <div className="game-play-area">
        {(stage === 'r1-countdown' || stage === 'r2-countdown') && (
          <div className="game-countdown-overlay">
            {stage === 'r2-countdown' && isFinalist && (
              <div style={{ color: 'var(--primary-glow)', fontWeight: 700, marginBottom: '0.5rem' }}>
                <Trophy size={18} style={{ verticalAlign: 'middle' }} /> You advanced to the final!
              </div>
            )}
            <div className="big-text" style={{ fontSize: '4rem' }}>
              {countdownNum > 0 ? countdownNum : 'GO!'}
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.7, marginTop: '0.5rem' }}>
              {stage === 'r1-countdown' ? 'All players start at the same time' : 'Final round: winner takes 1st, loser takes 2nd'}
            </p>
          </div>
        )}

        {playing && gameState.targets.map(target => {
          const progress = Math.min(1, (Date.now() - target.spawnedAt) / target.lifetime);
          return (
            <button
              key={target.id}
              className={`game-target target-${target.type}`}
              style={{
                left: `${target.x}px`, top: `${target.y}px`,
                width: target.size, height: target.size,
                opacity: Math.max(0.25, 1 - progress * 0.75),
                transform: `scale(${1 - progress * 0.3})`,
                backgroundColor: target.color,
              }}
              onClick={() => handleTargetClick(target.id)}
            />
          );
        })}

        {lastHitEffect && (
          <div className={`hit-effect effect-${lastHitEffect.quality}`} style={{ left: lastHitEffect.x, top: lastHitEffect.y }}>
            <span className="hit-score">{lastHitEffect.score > 0 ? '+' : ''}{lastHitEffect.score}</span>
            <span className="hit-label">{lastHitEffect.quality.toUpperCase()}</span>
          </div>
        )}

        {stage === 'r1-waiting' && (
          <div className="game-over-overlay">
            <div className="big-text">ROUND 1 OVER!</div>
            <div className="final-score">{gameState.score} pts</div>
            <div className="sub-text">Calculating who advances...</div>
          </div>
        )}

        {stage === 'r2-waiting' && (
          <div className="game-over-overlay">
            <div className="big-text">FINAL ROUND OVER!</div>
            <div className="final-score">{gameState.score} pts</div>
            <div className="sub-text">Confirming the result on-chain...</div>
            <div className="sub-text" style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: '0.3rem' }}>
              Usually within about 160 secs
            </div>
          </div>
        )}
      </div>

      <div className="game-bottom-stats">
        <span>Accuracy: {calculateAccuracy(gameState)}%</span>
        <span>Avg: {getAvgReactionTime(gameState)}ms</span>
        <span>Best Combo: x{gameState.maxCombo}</span>
      </div>
    </div>
  );
}
