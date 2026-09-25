import { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Target, Clock, Trophy, RotateCcw } from 'lucide-react';
import {
  createGameState, spawnTarget, hitTarget, removeExpiredTargets,
  getRandomSpawnInterval, calculateAccuracy, getAvgReactionTime, ROUND_DURATION_SEC,
} from '../lib/gameEngine';

const BEST_KEY = 'ff-practice-best';
// Matches .game-play-area's aspect-ratio (320/384) in App.css — same fixed
// spawn-space assumption GamePlay.jsx and EliminationFlow.jsx already use,
// which the CSS keeps close to true at any real screen width via 95vw/max-width.
const AREA_WIDTH  = 320;
const AREA_HEIGHT = 384;

export default function PracticeMode({ onBack }) {
  const [phase, setPhase] = useState('idle'); // idle | countdown | playing | finished
  const [countdownNum, setCountdownNum] = useState(3);
  const [gameState, setGameState] = useState(() => createGameState());
  const [lastHitEffect, setLastHitEffect] = useState(null);
  const [best, setBest] = useState(() => Number(localStorage.getItem(BEST_KEY) || 0));

  const spawnRef     = useRef(null);
  const cleanupRef   = useRef(null);
  const tickRef      = useRef(null);
  const gsRef        = useRef(gameState);
  const doneRef      = useRef(false);
  const gameEndAtRef = useRef(null);
  gsRef.current = gameState;

  const playing = phase === 'playing';

  const clearTimers = () => {
    clearTimeout(spawnRef.current);
    clearInterval(cleanupRef.current);
    clearInterval(tickRef.current);
  };

  useEffect(() => () => clearTimers(), []);

  const startCountdown = () => {
    setPhase('countdown');
    setCountdownNum(3);
    const iv = setInterval(() => {
      setCountdownNum(c => {
        if (c <= 1) { clearInterval(iv); startRound(); return 0; }
        return c - 1;
      });
    }, 700);
  };

  const startRound = () => {
    doneRef.current = false;
    gameEndAtRef.current = Date.now() + ROUND_DURATION_SEC * 1000;
    setGameState({ ...createGameState(), isActive: true, timeLeft: ROUND_DURATION_SEC });
    setPhase('playing');
  };

  // ─── Timer ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    tickRef.current = setInterval(() => {
      setGameState(prev => {
        const secsLeft = Math.max(0, Math.round((gameEndAtRef.current - Date.now()) / 1000));
        if (secsLeft <= 0) {
          clearTimers();
          if (!doneRef.current) {
            doneRef.current = true;
            if (prev.score > best) {
              setBest(prev.score);
              localStorage.setItem(BEST_KEY, String(prev.score));
            }
            setPhase('finished');
          }
          return { ...prev, timeLeft: 0, isActive: false };
        }
        return { ...prev, timeLeft: secsLeft };
      });
    }, 1000);
    return () => clearInterval(tickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ─── Spawner ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    const schedule = () => {
      spawnRef.current = setTimeout(() => {
        setGameState(prev => {
          if (!prev.isActive) return prev;
          const target = spawnTarget(prev, AREA_WIDTH, AREA_HEIGHT);
          return target ? { ...prev, targets: [...prev.targets, target] } : prev;
        });
        if (gsRef.current.isActive) schedule();
      }, getRandomSpawnInterval(gsRef.current.timeLeft));
    };
    schedule();
    return () => clearTimeout(spawnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ─── Expired-target cleanup ─────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    cleanupRef.current = setInterval(() => setGameState(prev => removeExpiredTargets({ ...prev, targets: [...prev.targets] })), 150);
    return () => clearInterval(cleanupRef.current);
  }, [playing]);

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

  if (phase === 'idle') {
    return (
      <div className="lobby">
        <div className="lobby-header">
          <h2>Practice Mode</h2>
          <p>No wallet, no stake — just beat your own score</p>
        </div>
        <div className="create-match-card" style={{ textAlign: 'center' }}>
          <Zap size={40} style={{ opacity: 0.5, marginBottom: '0.75rem' }} />
          <h3 style={{ justifyContent: 'center' }}>Ready?</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Same 60-second round as the real game. Your best score is saved on this device.
          </p>
          {best > 0 && (
            <div className="prize-preview" style={{ marginBottom: '1.25rem' }}>
              <Trophy size={14} /> Personal best: {best.toLocaleString()} pts
            </div>
          )}
          <button className="create-btn" onClick={startCountdown}>Start Practice Round</button>
          {onBack && (
            <button
              onClick={onBack}
              style={{ display: 'block', margin: '1rem auto 0', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              ← Back to Lobby
            </button>
          )}
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
      </div>

      <div className="game-play-area">
        {phase === 'countdown' && (
          <div className="game-countdown-overlay">
            <div className="big-text" style={{ fontSize: '4rem' }}>
              {countdownNum > 0 ? countdownNum : 'GO!'}
            </div>
            <p style={{ fontSize: '0.82rem', opacity: 0.7, marginTop: '0.5rem' }}>Practice round — no RF at stake</p>
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

        {phase === 'finished' && (
          <div className="game-over-overlay">
            <div className="big-text">TIME'S UP!</div>
            <div className="final-score">{gameState.score} pts</div>
            {gameState.score >= best && gameState.score > 0 && (
              <div className="sub-text" style={{ color: 'var(--primary-glow)' }}>🏆 New personal best!</div>
            )}
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="create-btn" onClick={startCountdown} style={{ margin: 0 }}>
                <RotateCcw size={14} /> Play Again
              </button>
              {onBack && (
                <button className="join-btn" onClick={onBack}>Back to Lobby</button>
              )}
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
