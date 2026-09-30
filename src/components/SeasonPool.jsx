import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { Crown, Wallet, Clock, Plus, CheckCircle, Zap } from 'lucide-react';
import {
  getCurrentSeason, createSeason, getSeasonLeaderboard, getSeasonPayouts, recordSeasonPayout,
} from '../lib/supabase';
import {
  formatWallet, getSeasonPoolStatus, startSeasonOnChain, endSeasonOnChain,
  fundSeasonPoolOnChain, payoutSeasonOnChain, SEASON_POOL_ADDRESS,
} from '../lib/blockchain';

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
  const { data: walletClient } = useWalletClient();
  const isAdmin = !!address && !!ADMIN_WALLET && address.toLowerCase() === ADMIN_WALLET;

  const [season, setSeason] = useState(null);
  const [chainStatus, setChainStatus] = useState(null);
  const [board, setBoard] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [txStatus, setTxStatus] = useState('');

  const [showNewSeason, setShowNewSeason] = useState(false);
  const [newDays, setNewDays] = useState(7);
  const [payoutForm, setPayoutForm] = useState({});
  const [fundAmount, setFundAmount] = useState('');

  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(iv); }, []);
  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [s, chain] = await Promise.all([getCurrentSeason(), getSeasonPoolStatus()]);
      setSeason(s);
      setChainStatus(chain);
      if (s) {
        const [lb, po] = await Promise.all([
          getSeasonLeaderboard(s.starts_at, s.ends_at),
          getSeasonPayouts(s.id),
        ]);
        setBoard(lb);
        setPayouts(po);
      }
    } catch (err) {
      console.error('Failed to load season:', err);
    }
    setLoading(false);
  };

  const handleCreateSeason = async () => {
    if (!walletClient || !address) return;
    try {
      setTxStatus('Starting season on-chain...');
      const chainResult = await startSeasonOnChain(walletClient);
      if (!chainResult.success) {
        setTxStatus(`Failed: ${chainResult.error}`);
        return;
      }
      setTxStatus('Recording season window...');
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + Number(newDays) * 86_400_000);
      await createSeason(startsAt.toISOString(), endsAt.toISOString(), SEASON_POOL_ADDRESS);
      setTxStatus('');
      setShowNewSeason(false);
      await load();
    } catch (err) {
      setTxStatus(`Failed: ${err.message}`);
    }
  };

  const handleEndSeason = async () => {
    if (!walletClient) return;
    setTxStatus('Ending season on-chain...');
    const result = await endSeasonOnChain(walletClient);
    setTxStatus(result.success ? '' : `Failed: ${result.error}`);
    if (result.success) await load();
  };

  const handleFundPool = async () => {
    if (!walletClient || !fundAmount) return;
    const result = await fundSeasonPoolOnChain(walletClient, fundAmount, setTxStatus);
    setTxStatus(result.success ? '' : `Failed: ${result.error}`);
    if (result.success) { setFundAmount(''); await load(); }
  };

  const handleRecordPayout = async (rank, walletAddress) => {
    const f = payoutForm[rank];
    if (!f?.amount || !walletClient) return;
    setTxStatus(`Paying rank ${rank}...`);
    const result = await payoutSeasonOnChain(walletClient, walletAddress, f.amount, `Season ${chainStatus?.seasonId ?? ''} rank ${rank}`);
    if (!result.success) {
      setTxStatus(`Failed: ${result.error}`);
      return;
    }
    await recordSeasonPayout(season.id, rank, walletAddress, f.amount, result.txId);
    setPayoutForm(prev => ({ ...prev, [rank]: { amount: '', txHash: '' } }));
    setTxStatus('');
    await load();
  };

  const endsMs = season ? new Date(season.ends_at).getTime() - now : 0;
  const payoutByRank = new Map(payouts.map(p => [p.rank, p]));
  const waitingToStart = !chainStatus || chainStatus.seasonId === 0;

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

      <div className="wallet-summary-card">
        <div className="wallet-address">
          <span className="waddr-label"><Wallet size={12} /> Pool Contract</span>
          <span className="waddr-value" title={SEASON_POOL_ADDRESS}>{formatWallet(SEASON_POOL_ADDRESS)}</span>
        </div>
        <div className="eth-balance-large">
          <span>{(chainStatus?.balance ?? 0).toLocaleString()}</span>
          <span className="eth-label"> RF</span>
        </div>
      </div>

      <div className="escrow-notice" style={{ marginTop: '0.75rem' }}>
        <Clock size={13} />
        {waitingToStart
          ? ' Waiting to start. Rake still accumulates here even before a season begins.'
          : chainStatus.seasonActive
            ? ` Season ${chainStatus.seasonId} active.`
            : ` Season ${chainStatus.seasonId} ended, awaiting payout.`}
      </div>

      {isAdmin && (
        <div className="create-match-card" style={{ marginTop: '0.75rem' }}>
          <div className="option-group">
            <label>Fund pool from your wallet</label>
            <div className="friend-check-row" style={{ margin: 0 }}>
              <input
                type="number" placeholder="RF amount" className="friend-id-input"
                value={fundAmount} onChange={e => setFundAmount(e.target.value)}
              />
              <button className="friend-check-btn" onClick={handleFundPool}>
                <Zap size={12} /> Fund
              </button>
            </div>
          </div>
        </div>
      )}

      {txStatus && <div className="escrow-notice" style={{ marginTop: '0.5rem' }}>{txStatus}</div>}

      {!season ? (
        <div className="no-data">
          <p>No scoring window set up yet.</p>
          {isAdmin && (
            <button className="create-btn" style={{ marginTop: '1rem' }} onClick={() => setShowNewSeason(true)}>
              <Plus size={14} /> Start a Season
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="escrow-notice" style={{ marginTop: '0.75rem' }}>
            <Clock size={13} /> {fmtCountdown(endsMs)}. Top 5 by cumulative in-game score this season
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
                          type="number" placeholder="RF to send" className="friend-id-input"
                          value={payoutForm[rank]?.amount || ''}
                          onChange={e => setPayoutForm(prev => ({ ...prev, [rank]: { ...prev[rank], amount: e.target.value } }))}
                        />
                        <button className="friend-check-btn" onClick={() => handleRecordPayout(rank, entry.wallet_address)}>Pay</button>
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

          {isAdmin && chainStatus?.seasonActive && endsMs <= 0 && (
            <button className="create-btn" style={{ marginTop: '1rem' }} onClick={handleEndSeason}>
              End Season On-Chain
            </button>
          )}
        </>
      )}

      {isAdmin && season && !showNewSeason && endsMs <= 0 && !chainStatus?.seasonActive && (
        <button className="create-btn" style={{ marginTop: '1rem' }} onClick={() => setShowNewSeason(true)}>
          <Plus size={14} /> Start Next Season
        </button>
      )}

      {isAdmin && showNewSeason && (
        <div className="create-match-card" style={{ marginTop: '1rem' }}>
          <h3>New Season</h3>
          <div className="option-group">
            <label>Duration (days)</label>
            <input className="friend-id-input" type="number" value={newDays} onChange={e => setNewDays(e.target.value)} />
          </div>
          <button className="create-btn" style={{ marginTop: '0.75rem' }} onClick={handleCreateSeason}>
            Start Season (calls startSeason() on-chain)
          </button>
        </div>
      )}
    </div>
  );
}
