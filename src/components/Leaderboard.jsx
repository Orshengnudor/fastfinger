import { useState, useEffect } from 'react';
import { getLeaderboard } from '../lib/supabase';
import { Crown, RefreshCw, Trophy, Gamepad2, ChevronLeft, ChevronRight } from 'lucide-react';

const formatWalletFull = (address) => {
  if (!address) return '—';
  const s = String(address);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}....${s.slice(-4)}`;
};

const PAGE_SIZE = 10;

export default function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [page,    setPage]    = useState(0);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setPage(0);
    try {
      const real = await getLeaderboard();
      setEntries(real || []);
    } catch {
      setError('Could not load leaderboard. Please try again.');
    }
    setLoading(false);
  };

  const totalPages  = Math.ceil(entries.length / PAGE_SIZE);
  const pageEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) return (
    <div className="leaderboard">
      <div className="leaderboard-header"><Crown size={22} /><h2>Global Rankings</h2></div>
      <div className="lb-loading"><RefreshCw size={20} className="spinning" /><p>Loading rankings...</p></div>
    </div>
  );

  if (error) return (
    <div className="leaderboard">
      <div className="leaderboard-header"><Crown size={22} /><h2>Global Rankings</h2></div>
      <div className="lb-error"><p>{error}</p><button className="lb-retry-btn" onClick={loadData}>Retry</button></div>
    </div>
  );

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <Crown size={22} />
        <h2>Global Rankings</h2>
        <button className="lb-refresh-btn" onClick={loadData} title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="no-data">
          <Gamepad2 size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <p>No matches played yet. Be the first to bust the table!</p>
        </div>
      ) : (
        <>
          <div className="leaderboard-table">
            <div className="lb-header-row">
              <span>#</span>
              <span>Player</span>
              <span><Gamepad2 size={11} /> Games</span>
              <span><Trophy size={11} /> Wins</span>
              <span>RF Won</span>
            </div>

            {pageEntries.map((entry, i) => {
              const globalRank = page * PAGE_SIZE + i;
              return (
                <div
                  key={entry.wallet_address || i}
                  className={[
                    'lb-row',
                    globalRank === 0 ? 'top-1' : globalRank === 1 ? 'top-2' : globalRank === 2 ? 'top-3' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="lb-rank">
                    {globalRank === 0 ? '🥇' : globalRank === 1 ? '🥈' : globalRank === 2 ? '🥉' : `#${globalRank + 1}`}
                  </span>
                  <span className="lb-wallet" title={entry.wallet_address}>
                    {formatWalletFull(entry.wallet_address)}
                  </span>
                  <span className="lb-games">{entry.total_games ?? 0}</span>
                  <span className="lb-wins">{entry.total_wins ?? 0}</span>
                  <span className="lb-eth">{parseFloat(entry.total_rf_won || 0).toLocaleString()} RF</span>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="lb-pagination">
              <button
                className="lb-page-btn"
                onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo(0,0); }}
                disabled={page === 0}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="lb-page-info">Page {page + 1} of {totalPages}</div>
              <button
                className="lb-page-btn"
                onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo(0,0); }}
                disabled={page === totalPages - 1}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
