import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { updatePlayerScore, subscribeToMatch, getMatchPlayers, finishMatch, supabase } from '../lib/supabase';
import { formatWallet } from '../lib/blockchain';
import {
  createGameState, spawnTarget, hitTarget, removeExpiredTargets,
  getRandomSpawnInterval, calculateAccuracy, getAvgReactionTime, ROUND_DURATION_SEC,
} from '../lib/gameEngine';
import { Zap, Target, Clock } from 'lucide-react';

export default function GamePlay({ match, players: initialPlayers, onGameEnd }) {
  const { address } = useAccount();

  const [gameState,     setGameState]     = useState(() => createGameState());
  const [opponents,     setOpponents]     = useState(initialPlayers || []);
  const [lastHitEffect, setLastHitEffect] = useState(null);
  const [phase,         setPhase]         = useState('countdown');
  const [countdownNum,  setCountdownNum]  = useState(null);

  const spawnRef   = useRef(null);
  const cleanupRef = useRef(null);
  const tickRef    = useRef(null);
  const gsRef      = useRef(gameState);
  const doneRef    = useRef(false);
  // Store the UTC end time so the timer always stops at the right moment
  const gameEndAtRef = useRef(null);
  gsRef.current    = gameState;

  const AREA_WIDTH  = 320;
  const AREA_HEIGHT = 384;
  const isHost      = address === match?.host_wallet;

  // ─── Sync opponents ───────────────────────────────────────────────────────
  useEffect(() => {
    const ch = subscribeToMatch(match.id, async () => {
      const data = await getMatchPlayers(match.id);
      setOpponents(data);
    });
    return () => { ch.unsubscribe(); };
  }, [match.id]);

  // ─── Start logic ──────────────────────────────────────────────────────────
  // The game ends at a fixed UTC time: game_start_time + ROUND_DURATION_SEC.
  // Everyone — early or late — ends at that exact moment.
  // Late joiners simply have less time to score.
  useEffect(() => {
    const gameStartTime = match.game_start_time;

    if (!gameStartTime) {
      console.warn('[GamePlay] No game_start_time, starting immediately with full time');
      gameEndAtRef.current = Date.now() + ROUND_DURATION_SEC * 1000;
      setCountdownNum(0);
      beginGame(ROUND_DURATION_SEC);
      return;
    }

    const startAt  = new Date(gameStartTime).getTime();
    // The moment everyone's game ends — fixed for all players
    const endAt    = startAt + ROUND_DURATION_SEC * 1000;
    gameEndAtRef.current = endAt;

    const now        = Date.now();
    const msUntilEnd = endAt - now;

    if (msUntilEnd <= 0) {
      // Game already fully over — go straight to finished
      console.log('[GamePlay] Game already ended, showing results');
      setPhase('finished');
      setTimeout(() => handleGameOver(gsRef.current), 500);
      return;
    }

    const msUntilStart = startAt - now;

    if (msUntilStart > 0) {
      // Game hasn't started yet — show countdown then begin with full time
      const totalSecs = Math.ceil(msUntilStart / 1000);
      setCountdownNum(totalSecs);

      const interval = setInterval(() => {
        const secs = Math.ceil((startAt - Date.now()) / 1000);
        setCountdownNum(Math.max(0, secs));
      }, 250);

      const timer = setTimeout(() => {
        clearInterval(interval);
        const remainingSec = Math.round((gameEndAtRef.current - Date.now()) / 1000);
        beginGame(Math.max(1, remainingSec));
      }, msUntilStart);

      console.log(`[GamePlay] Starts in ${msUntilStart}ms, full ${ROUND_DURATION_SEC}s`);
      return () => { clearInterval(interval); clearTimeout(timer); };

    } else {
      // Game already started — join mid-game with only remaining time
      const remainingSec = Math.round(msUntilEnd / 1000);
      console.log(`[GamePlay] Late join — ${remainingSec}s remaining`);
      setCountdownNum(0);
      beginGame(Math.max(1, remainingSec));
    }
  }, []);

  const beginGame = (durationSec) => {
    setPhase('playing');
    setCountdownNum(null);
    setGameState(prev => ({ ...prev, isActive: true, timeLeft: durationSec }));
  };

  // ─── Game timer — ticks down and ends at the right UTC moment ─────────────
  useEffect(() => {
    if (phase !== 'playing') return;

    tickRef.current = setInterval(() => {
      setGameState(prev => {
        // Always check against the real end time, not just the countdown
        const msLeft = gameEndAtRef.current
          ? gameEndAtRef.current - Date.now()
          : prev.timeLeft * 1000 - 1000;

        const secsLeft = Math.max(0, Math.round(msLeft / 1000));

        if (secsLeft <= 0) {
          clearInterval(tickRef.current);
          clearTimeout(spawnRef.current);
          clearInterval(cleanupRef.current);
          const final = { ...prev, timeLeft: 0, isActive: false };
          if (!doneRef.current) {
            doneRef.current = true;
            setPhase('finished');
            setTimeout(() => handleGameOver(final), 800);
          }
          return final;
        }

        return { ...prev, timeLeft: secsLeft };
      });
    }, 1000);

    return () => clearInterval(tickRef.current);
  }, [phase]);

  // ─── Target spawner ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
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
  }, [phase]);

  // ─── Expire targets ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    cleanupRef.current = setInterval(() => {
      setGameState(prev => removeExpiredTargets({ ...prev }));
    }, 150);
    return () => clearInterval(cleanupRef.current);
  }, [phase]);

  // ─── Score sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing' || !address) return;
    const sync = setInterval(() => {
      const gs = gsRef.current;
      updatePlayerScore(match.id, address, gs.score, getAvgReactionTime(gs));
    }, 1500);
    return () => clearInterval(sync);
  }, [phase, address, match.id]);

  // ─── Click handler ────────────────────────────────────────────────────────
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

  // ─── Game over ────────────────────────────────────────────────────────────
  // All players end at the same UTC moment so no waiting needed.
  // Host pushes final score and declares winner.
  // Non-host pushes final score and waits 3s for host to write winner to DB.
  const handleGameOver = async (finalState) => {
    if (!address) return;

    // Push this player's final score
    await updatePlayerScore(
      match.id, address,
      finalState.score,
      getAvgReactionTime(finalState)
    );

    if (isHost) {
      // Give all players 2s to push their final scores, then pick winner
      await new Promise(r => setTimeout(r, 2000));

      const all    = await getMatchPlayers(match.id);
      const sorted = [...all].sort((a, b) => b.score - a.score);
      const top    = sorted[0]?.score ?? 0;
      const tied   = sorted.filter(p => p.score === top);
      const winner = tied.length === 1
        ? sorted[0]
        : tied.sort(
            (a, b) => (a.avg_reaction_time || 9999) - (b.avg_reaction_time || 9999)
          )[0];

      await finishMatch(match.id, winner.wallet_address);

      onGameEnd({
        ...finalState,
        allPlayers:  sorted,
        winner:      winner.wallet_address,
        isWinner:    winner.wallet_address.toLowerCase() === address.toLowerCase(),
        prizePool:   match.prize_pool || 0,
        perfectHits: finalState.perfectHits,
        maxCombo:    finalState.maxCombo,
      });

    } else {
      // Non-host: wait for host to declare winner (host needs 2s + finishMatch time)
      await new Promise(r => setTimeout(r, 4000));

      const all = await getMatchPlayers(match.id);
      const sorted = [...all].sort((a, b) => b.score - a.score);

      const { data: matchRow } = await supabase
        .from('matches')
        .select('winner_wallet')
        .eq('id', match.id)
        .single();

      const winnerWallet = matchRow?.winner_wallet || sorted[0]?.wallet_address;

      onGameEnd({
        ...finalState,
        allPlayers:  sorted,
        winner:      winnerWallet,
        isWinner:    winnerWallet?.toLowerCase() === address.toLowerCase(),
        prizePool:   match.prize_pool || 0,
        perfectHits: finalState.perfectHits,
        maxCombo:    finalState.maxCombo,
      });
    }
  };

  return (
    <div className="gameplay">
      <div className="game-hud">
        <div className="hud-item score"><Zap size={16} /><span>{gameState.score}</span></div>
        <div className="hud-item timer">
          <Clock size={16} />
          <span className={gameState.timeLeft <= 10 ? 'urgent' : ''}>{gameState.timeLeft}s</span>
        </div>
        <div className="hud-item combo"><Target size={16} /><span>x{gameState.combo}</span></div>
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
        {phase === 'countdown' && (
          <div className="game-countdown-overlay">
            <div className="big-text" style={{ fontSize: '4rem' }}>
              {countdownNum > 0 ? countdownNum : 'GO!'}
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.7, marginTop: '0.5rem' }}>
              All players start at the same time
            </p>
          </div>
        )}

        {phase === 'playing' && gameState.targets.map(target => {
          const progress = Math.min(1, (Date.now() - target.spawnedAt) / target.lifetime);
          return (
            <button
              key={target.id}
              className={`game-target target-${target.type}`}
              style={{
                left:            `${target.x}px`,
                top:             `${target.y}px`,
                width:           target.size,
                height:          target.size,
                opacity:         Math.max(0.25, 1 - progress * 0.75),
                transform:       `scale(${1 - progress * 0.3})`,
                backgroundColor: target.color,
              }}
              onClick={() => handleTargetClick(target.id)}
            />
          );
        })}

        {lastHitEffect && (
          <div
            className={`hit-effect effect-${lastHitEffect.quality}`}
            style={{ left: lastHitEffect.x, top: lastHitEffect.y }}
          >
            <span className="hit-score">{lastHitEffect.score > 0 ? '+' : ''}{lastHitEffect.score}</span>
            <span className="hit-label">{lastHitEffect.quality.toUpperCase()}</span>
          </div>
        )}

        {phase === 'finished' && (
          <div className="game-over-overlay">
            <div className="big-text">TIME'S UP!</div>
            <div className="final-score">{gameState.score} pts</div>
            <div className="sub-text">Calculating results...</div>
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