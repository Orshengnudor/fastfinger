import { useState } from 'react';
import { Trophy, Medal, Star, ArrowLeft, Zap, Target, Skull } from 'lucide-react';
import { formatWallet, previewSplit, previewEliminationSplit } from '../lib/blockchain';
import WinShareCard from './WinShareCard';

function StandardResults({ results, match, onBackToLobby }) {
  const [showCard, setShowCard] = useState(false);
  const { allPlayers, winner, isWinner, prizePool, score, hits, perfectHits, maxCombo } = results;
  const pool = parseFloat(prizePool || 0);
  const { payout: basePayout }   = previewSplit(pool, false);
  const { payout: friendPayout } = previewSplit(pool, true);
  const youWon = isWinner === true;

  return (
    <div className="game-results">
      <div className="results-card">
        <div className={`winner-banner ${youWon ? 'you-won' : ''}`}>
          {youWon ? (
            <>
              <Trophy size={48} className="trophy-icon" />
              <h1>YOU WIN!</h1>
              <p className="prize-won">🏆 {basePayout.toLocaleString()}–{friendPayout.toLocaleString()} RF</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Go to Dashboard to claim: 92% with a hardwired Generations Friend, 90% without
              </p>
              <button className="share-win-btn" onClick={() => setShowCard(true)}>
                🎉 Share Your Win
              </button>
            </>
          ) : (
            <>
              <Medal size={48} />
              <h1>Match Complete</h1>
              <p>Winner: {formatWallet(winner)}</p>
            </>
          )}
        </div>

        <div className="your-stats">
          <h3>Your Performance</h3>
          <div className="stats-grid">
            <div className="stat-card"><Zap size={18} /><span className="stat-val">{score}</span><span className="stat-lbl">Score</span></div>
            <div className="stat-card"><Target size={18} /><span className="stat-val">{hits}</span><span className="stat-lbl">Hits</span></div>
            <div className="stat-card"><Star size={18} /><span className="stat-val">{perfectHits ?? 0}</span><span className="stat-lbl">Perfect</span></div>
            <div className="stat-card"><span className="stat-val">x{maxCombo ?? 0}</span><span className="stat-lbl">Best Combo</span></div>
          </div>
        </div>

        <div className="results-leaderboard">
          <h3>Final Rankings</h3>
          {(allPlayers || []).map((p, i) => (
            <div key={p.id || i} className={`rank-row ${p.wallet_address?.toLowerCase() === winner?.toLowerCase() ? 'is-winner' : ''}`}>
              <span className="rank-pos">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
              <span className="rank-wallet">{formatWallet(p.wallet_address)}</span>
              <span className="rank-score">{p.score} pts</span>
              <span className="rank-reaction">{p.avg_reaction_time || '-'}ms</span>
            </div>
          ))}
        </div>

        <button className="back-btn" onClick={onBackToLobby}>
          <ArrowLeft size={16} /> Back to Lobby
        </button>
      </div>

      {showCard && youWon && (
        <WinShareCard results={{ ...results, prizePool: pool }} match={match} onClose={() => setShowCard(false)} />
      )}
    </div>
  );
}

function EliminationResults({ results, onBackToLobby }) {
  const { place, winner, runnerUp, third, round1Players, round2Players, prizePool, score } = results;
  const pool = parseFloat(prizePool || 0);
  const split = previewEliminationSplit(pool);
  const payoutFor = place === 1 ? split.first : place === 2 ? split.second : place === 3 ? split.third : 0;
  const placed = place === 1 || place === 2 || place === 3;

  return (
    <div className="game-results">
      <div className="results-card">
        <div className={`winner-banner ${place === 1 ? 'you-won' : ''}`}>
          {place === 1 && (
            <>
              <Trophy size={48} className="trophy-icon" />
              <h1>1ST PLACE!</h1>
              <p className="prize-won">🏆 {payoutFor.toLocaleString()} RF</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Go to Dashboard to claim once the match is confirmed on-chain
              </p>
            </>
          )}
          {place === 2 && (
            <>
              <Medal size={48} />
              <h1>2ND PLACE</h1>
              <p className="prize-won">🥈 {payoutFor.toLocaleString()} RF</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Go to Dashboard to claim once the match is confirmed on-chain
              </p>
            </>
          )}
          {place === 3 && (
            <>
              <Star size={48} />
              <h1>3RD PLACE</h1>
              <p className="prize-won">🥉 {payoutFor.toLocaleString()} RF</p>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Go to Dashboard to claim once the match is confirmed on-chain
              </p>
            </>
          )}
          {!placed && (
            <>
              <Skull size={48} style={{ opacity: 0.6 }} />
              <h1>Eliminated</h1>
              <p>You didn't place in the top 3 this time.</p>
            </>
          )}
        </div>

        <div className="your-stats">
          <h3>Your Score</h3>
          <div className="stats-grid">
            <div className="stat-card"><Zap size={18} /><span className="stat-val">{score}</span><span className="stat-lbl">Score</span></div>
          </div>
        </div>

        <div className="results-leaderboard">
          <h3>Round 1 Rankings</h3>
          {(round1Players || []).map((p, i) => (
            <div
              key={p.id || i}
              className={`rank-row ${[winner, runnerUp, third].map(w => w?.toLowerCase()).includes(p.wallet_address?.toLowerCase()) ? 'is-winner' : ''}`}
            >
              <span className="rank-pos">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
              <span className="rank-wallet">{formatWallet(p.wallet_address)}</span>
              <span className="rank-score">{p.score} pts</span>
              <span className="rank-reaction">{p.avg_reaction_time || '-'}ms</span>
            </div>
          ))}
        </div>

        {round2Players && round2Players.length > 0 && (
          <div className="results-leaderboard">
            <h3>Final Round (1st vs 2nd)</h3>
            {round2Players.map((p, i) => (
              <div key={p.id || i} className={`rank-row ${i === 0 ? 'is-winner' : ''}`}>
                <span className="rank-pos">{i === 0 ? '🥇' : '🥈'}</span>
                <span className="rank-wallet">{formatWallet(p.wallet_address)}</span>
                <span className="rank-score">{p.score} pts</span>
                <span className="rank-reaction">{p.avg_reaction_time || '-'}ms</span>
              </div>
            ))}
          </div>
        )}

        <button className="back-btn" onClick={onBackToLobby}>
          <ArrowLeft size={16} /> Back to Lobby
        </button>
      </div>
    </div>
  );
}

export default function GameResults({ results, match, onBackToLobby }) {
  if (results.mode === 'elimination') {
    return <EliminationResults results={results} onBackToLobby={onBackToLobby} />;
  }
  return <StandardResults results={results} match={match} onBackToLobby={onBackToLobby} />;
}
