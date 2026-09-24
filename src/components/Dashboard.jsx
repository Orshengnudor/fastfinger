import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { getClaimableWins, markPrizeClaimed, recordRfWin } from '../lib/supabase';
import {
  formatWallet,
  claimPrizeOnChain,
  checkFriendEligible,
  previewSplit,
  getRfBalance,
  getTierByIndex,
  explorerTx,
} from '../lib/blockchain';
import {
  Trophy, Gift, Clock, CheckCircle, Sparkles,
  ExternalLink, Wallet, AlertCircle, Shield, Search,
} from 'lucide-react';

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { data: walletClient }   = useWalletClient();

  const [claimable,  setClaimable]  = useState([]);
  const [claiming,   setClaiming]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [txStatus,   setTxStatus]   = useState({});
  const [rfBalance,  setRfBalance]  = useState(0);
  // Per-match Friend-ID input: { [matchId]: { value, checking, eligible } }
  const [friendState, setFriendState] = useState({});

  useEffect(() => {
    if (address) {
      loadClaimable();
      getRfBalance(address).then(setRfBalance);
    }
  }, [address]);

  const loadClaimable = async () => {
    setLoading(true);
    try {
      const data = await getClaimableWins(address);
      setClaimable(data);
    } catch (err) {
      console.error('Failed to load claimable:', err);
    }
    setLoading(false);
  };

  const friendFor = (matchId) => friendState[matchId] || { value: '', checking: false, eligible: null };

  const setFriendValue = (matchId, value) => {
    setFriendState(prev => ({ ...prev, [matchId]: { value, checking: false, eligible: null } }));
  };

  const checkFriend = async (matchId) => {
    const f = friendFor(matchId);
    if (!f.value) return;
    setFriendState(prev => ({ ...prev, [matchId]: { ...f, checking: true, eligible: null } }));
    const eligible = await checkFriendEligible(address, f.value);
    setFriendState(prev => ({ ...prev, [matchId]: { ...f, checking: false, eligible } }));
  };

  const handleClaim = async (match) => {
    if (!walletClient || !address) return;
    setError('');
    setClaiming(match.id);
    setTxStatus(prev => ({ ...prev, [match.id]: 'Confirm the claim in your wallet...' }));

    const f = friendFor(match.id);
    const useFriend = f.eligible === true && f.value;
    const friendId = useFriend ? BigInt(f.value) : 0n;

    try {
      const result = await claimPrizeOnChain(walletClient, match.id, friendId);

      if (!result.success) {
        setError(result.error || 'Claim failed. Please try again.');
        setClaiming(null);
        setTxStatus(prev => ({ ...prev, [match.id]: '' }));
        return;
      }

      const pool = parseFloat(match.prize_pool || 0);
      const { payout } = previewSplit(pool, useFriend);

      setTxStatus(prev => ({
        ...prev,
        [match.id]: `Claimed ${payout.toLocaleString()} RF! TX: ${result.txId?.slice(0, 10)}...`,
      }));

      await markPrizeClaimed(match.id, result.txId || '');
      await recordRfWin(address, payout);
      getRfBalance(address).then(setRfBalance);
      await loadClaimable();
    } catch (err) {
      setError(err.message);
    }

    setClaiming(null);
  };

  if (!isConnected) {
    return (
      <div className="dashboard">
        <div className="no-data">
          <Wallet size={32} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
          <p>Connect your wallet to view your dashboard.</p>
        </div>
      </div>
    );
  }

  const totalClaimableRf = claimable.reduce((sum, m) => {
    const { payout } = previewSplit(parseFloat(m.prize_pool || 0), false);
    return sum + payout;
  }, 0);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <Trophy size={22} />
        <h2>Your Dashboard</h2>
      </div>

      {/* Wallet Summary */}
      <div className="wallet-summary-card">
        <div className="wallet-address">
          <span className="waddr-label">Wallet</span>
          <span className="waddr-value" title={address}>
            {formatWallet(address)}
          </span>
        </div>
        <div className="eth-balance-large">
          <span>{rfBalance.toFixed(2)}</span>
          <span className="eth-label"> RF</span>
        </div>
      </div>

      {error && (
        <div className="lobby-error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Summary */}
      <div className="dashboard-summary">
        <div className="summary-card">
          <Gift size={18} />
          <span className="summary-val">{claimable.length}</span>
          <span className="summary-lbl">Prizes to Claim</span>
        </div>
        <div className="summary-card highlight">
          <Trophy size={18} />
          <span className="summary-val">{totalClaimableRf.toLocaleString()}+</span>
          <span className="summary-lbl">RF to Claim</span>
        </div>
      </div>

      {/* Claimable Prizes */}
      {loading ? (
        <div className="no-data"><p>Loading prizes...</p></div>
      ) : claimable.length === 0 ? (
        <div className="no-data">
          <Trophy size={32} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
          <p>No prizes to claim yet.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Win a match to earn RF!</p>
        </div>
      ) : (
        <div className="claim-list">
          <h3 className="claim-section-title">Unclaimed Prizes</h3>
          {claimable.map(match => {
            const pool      = parseFloat(match.prize_pool || 0);
            const tier      = getTierByIndex(match.tier ?? 0);
            const statusMsg = txStatus[match.id];
            const f         = friendFor(match.id);
            const useFriend = f.eligible === true;
            const { payout, burn, reward } = previewSplit(pool, useFriend);

            return (
              <div key={match.id} className="claim-card">
                <div className="claim-info">
                  <div className="claim-match-id">
                    {tier.icon} {tier.rf} RF Pool · Match #{match.id.slice(0, 8)}
                    {match.declare_tx && (
                      <a
                        href={explorerTx(match.declare_tx)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="explorer-link"
                        title="View on Blockscout"
                      >
                        <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                  <div className="claim-details">
                    <span>Prize pool: <strong>{pool.toLocaleString()} RF</strong></span>
                    <span>Burn + rewards ({useFriend ? '8%' : '10%'}): <strong>{(burn + reward).toLocaleString()} RF</strong></span>
                  </div>
                  <div className="claim-payout">
                    You receive: <strong>{payout.toLocaleString()} RF</strong> {useFriend && <span title="Hardwired Friend bonus"><Sparkles size={12} /> 92%</span>}
                  </div>

                  {/* Friend bonus lookup */}
                  <div className="friend-check-row">
                    <input
                      type="number"
                      min="1"
                      placeholder="Friend ID (optional, for 92%)"
                      value={f.value}
                      onChange={e => setFriendValue(match.id, e.target.value.replace(/[^0-9]/g, ''))}
                      className="friend-id-input"
                    />
                    <button
                      className="friend-check-btn"
                      onClick={() => checkFriend(match.id)}
                      disabled={!f.value || f.checking}
                    >
                      <Search size={13} /> {f.checking ? 'Checking...' : 'Check'}
                    </button>
                  </div>
                  {f.eligible === true && (
                    <div className="friend-eligible-yes"><Sparkles size={12} /> Eligible: claim will pay 92%</div>
                  )}
                  {f.eligible === false && (
                    <div className="friend-eligible-no">Not a hardwired Friend you own: claim will pay 90%</div>
                  )}

                  {match.finished_at && (
                    <div className="claim-date">
                      <Clock size={11} /> {new Date(match.finished_at).toLocaleString()}
                    </div>
                  )}
                  {statusMsg && <div className="claim-tx-status">{statusMsg}</div>}
                </div>
                <button
                  className="claim-btn"
                  onClick={() => handleClaim(match)}
                  disabled={claiming === match.id}
                >
                  {claiming === match.id
                    ? 'Claiming...'
                    : <><CheckCircle size={14} /> Claim {payout.toLocaleString()} RF</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="escrow-explainer">
        <Shield size={13} />
        RF is held in a Robinhood Chain smart contract. Claiming sends it directly to your wallet on-chain. Gas is paid in ETH.
      </div>
    </div>
  );
}
