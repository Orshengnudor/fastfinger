import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Crown, Wallet, Clock, Plus, CheckCircle } from 'lucide-react';
import {
  getCurrentSeason, createSeason, getSeasonLeaderboard, getSeasonPayouts, recordSeasonPayout,
} from '../lib/supabase';
import { getRfBalance, formatWallet } from '../lib/blockchain';

const ADMIN_WALLET = (import.meta.env.VITE_ADMIN_WALLET || '').toLowerCase();

const fmtCountdown = (ms) => {
  if (ms <= 0) return 'Season ended';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${d}d ${h}h ${m}m left`;
};

export default function SeasonPool() {
  const { address } = useAccount();
  const isAdmin = !!address && !!ADMIN_WALLET && address.toLowerCase() === ADMIN_WALLET;

  const [season, setSeason] = useState(null);
  const [poolBalance, setPoolBalance] = useState(0);
  const [board, setBoard] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const [showNewSeason, setShowNewSeason] = useState(false);
  const [newWallet, setNewWallet] = useState('');
  const [newDays, setNewDays] = useState(7);
  const [payoutForm, setPayoutForm] = useState({});

  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(iv); }, []);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const s = await getCurrentSeason();
      setSeason(s);
      if (s) {
        const [bal, lb, po] = await Promise.all([
          getRfBalance(s.pool_wallet),
          getSeasonLeaderboard(s.starts_at, s.ends_at),
          getSeasonPayouts(s.id),
        ]);
        setPoolBalance(bal);
        setBoard(lb);
        setPayouts(po);
      }
    } catch (err) {
      console.error('Failed to load season:', err);
    }
    setLoading(false);
  };

  const handleCreateSeason = async () => {
    if (!newWallet) return;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + Number(newDays) * 86_400_000);
    await createSeason(startsAt.toISOString(), endsAt.toISOString(), newWallet);
    setShowNewSeason(false);
    setNewWallet('');
    await load();
  };

  const handleRecordPayout = async (rank, walletAddress) => {
    const f = payoutForm[rank];
    if (!f?.amount) return;
    await recordSeasonPayout(season.id, rank, walletAddress, f.amount, f.txHash);
    setPayoutForm(prev => ({ ...prev, [rank]: { amount: '', txHash: '' } }));
    await load();
  };

  const endsMs = season ? new Date(season.ends_at).getTime() - now : 0;
  const payoutByRank = new Map(payouts.map(p => [p.rank, p]));

  if (loading) {
    return (
      <div className="leaderboard">
        <div className="leaderboard-header"><Crown size={22} /><h2>Season Pool</h2></div>
        <div className="lb-loading"><p>Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <Crown size={22} />
        <h2>Season Pool</h2>
      </div>

      {!season ? (
        <div className="no-data">
          <p>No active season right now.</p>
          {isAdmin && (
            <button className="create-btn" style={{ marginTop: '1rem' }} onClick={() => setShowNewSeason(true)}>
              <Plus size={14} /> Start a Season
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="wallet-summary-card">
            <div className="wallet-address">
              <span className="waddr-label"><Wallet size={12} /> Pool Wallet</span>
              <span className="waddr-value" title={season.pool_wallet}>{formatWallet(season.pool_wallet)}</span>
            </div>
            <div className="eth-balance-large">
              <span>{poolBalance.toLocaleString()}</span>
              <span className="eth-label"> RF</span>
            </div>
          </div>

          <div className="escrow-notice" style={{ marginTop: '0.75rem' }}>
            <Clock size={13} /> {fmtCountdown(endsMs)} — top 5 by cumulative in-game score this season
          </div>

          <div className="leaderboard-table" style={{ marginTop: '1rem' }}>
            <div className="lb-header-row">
              <span>#</span>
              <span>Player</span>
              <span colSpan={2}>Points</span>
            </div>
            {board.length === 0 ? (
              <div className="no-data"><p>No games played yet this season.</p></div>
            ) : board.map((entry, i) => {
              const rank = i + 1;
              const paid = payoutByRank.get(rank);
              return (
                <div key={entry.wallet_address} className={`lb-row ${rank === 1 ? 'top-1' : rank === 2 ? 'top-2' : rank === 3 ? 'top-3' : ''}`}>
                  <span className="lb-rank">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}</span>
                  <span className="lb-wallet">{formatWallet(entry.wallet_address)}</span>
                  <span className="lb-eth">{entry.points.toLocaleString()} pts</span>
                  <span>
                    {paid ? (
                      <span className="friend-eligible-yes"><CheckCircle size={12} /> Paid {paid.amount} RF</span>
                    ) : isAdmin && endsMs <= 0 ? (
                      <div className="friend-check-row" style={{ margin: 0 }}>
                        <input
                          type="number" placeholder="RF sent" className="friend-id-input"
                          value={payoutForm[rank]?.amount || ''}
                          onChange={e => setPayoutForm(prev => ({ ...prev, [rank]: { ...prev[rank], amount: e.target.value } }))}
                        />
                        <button className="friend-check-btn" onClick={() => handleRecordPayout(rank, entry.wallet_address)}>Record</button>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {endsMs > 0 ? 'Pays at season end' : 'Awaiting payout'}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {isAdmin && season && !showNewSeason && endsMs <= 0 && (
        <button className="create-btn" style={{ marginTop: '1rem' }} onClick={() => setShowNewSeason(true)}>
          <Plus size={14} /> Start Next Season
        </button>
      )}

      {isAdmin && showNewSeason && (
        <div className="create-match-card" style={{ marginTop: '1rem' }}>
          <h3>New Season</h3>
          <div className="option-group">
            <label>Pool wallet address</label>
            <input className="friend-id-input" style={{ width: '100%' }} value={newWallet} onChange={e => setNewWallet(e.target.value)} placeholder="0x..." />
          </div>
          <div className="option-group" style={{ marginTop: '0.5rem' }}>
            <label>Duration (days)</label>
            <input className="friend-id-input" type="number" value={newDays} onChange={e => setNewDays(e.target.value)} />
          </div>
          <button className="create-btn" style={{ marginTop: '0.75rem' }} onClick={handleCreateSeason}>Start Season</button>
        </div>
      )}
    </div>
  );
}
