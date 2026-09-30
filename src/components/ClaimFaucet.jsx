import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { Gift, Users, CheckCircle } from 'lucide-react';
import { getFaucetStatus, claimFaucetOnChain, FAUCET_ADDRESS } from '../lib/blockchain';

export default function ClaimFaucet() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [txStatus, setTxStatus] = useState('');

  useEffect(() => { load(); }, [address]);

  const load = async () => {
    setLoading(true);
    const s = await getFaucetStatus(address);
    setStatus(s);
    setLoading(false);
  };

  const handleClaim = async () => {
    if (!walletClient) return;
    setClaiming(true);
    setTxStatus('Claiming your 20 RF...');
    const result = await claimFaucetOnChain(walletClient);
    if (result.success) {
      setTxStatus('Claimed! Welcome to FastFinger.');
      await load();
    } else {
      setTxStatus(`Failed: ${result.error}`);
    }
    setClaiming(false);
  };

  if (loading) {
    return (
      <div className="leaderboard">
        <div className="leaderboard-header"><Gift size={22} /><h2>Claim Your Start</h2></div>
        <div className="lb-loading"><p>Loading...</p></div>
      </div>
    );
  }

  const soldOut = status.remaining === 0;
  const closed = !status.claimOpen;

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <Gift size={22} />
        <h2>Claim Your Start</h2>
      </div>

      <div className="wallet-summary-card">
        <div className="wallet-address">
          <span className="waddr-label"><Users size={12} /> Spots claimed</span>
          <span className="waddr-value">{status.claimedCount} / {status.maxClaims}</span>
        </div>
        <div className="eth-balance-large">
          <span>{status.claimAmount}</span>
          <span className="eth-label"> RF each</span>
        </div>
      </div>

      <div className="escrow-notice" style={{ marginTop: '0.75rem' }}>
        {closed
          ? 'This promotion is currently closed.'
          : soldOut
            ? 'All spots have been claimed.'
            : `${status.remaining} spot${status.remaining === 1 ? '' : 's'} left for the first ${status.maxClaims} wallets. One claim per wallet.`}
      </div>

      <div style={{ marginTop: '1rem' }}>
        {!isConnected ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Connect your wallet to check eligibility.</p>
        ) : status.hasClaimed ? (
          <div className="friend-eligible-yes"><CheckCircle size={14} /> You already claimed your 20 RF.</div>
        ) : closed || soldOut ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No further claims available.</p>
        ) : (
          <button className="create-btn" onClick={handleClaim} disabled={claiming}>
            {claiming ? 'Claiming...' : `Claim ${status.claimAmount} RF`}
          </button>
        )}
      </div>

      {txStatus && <div className="escrow-notice" style={{ marginTop: '0.75rem' }}>{txStatus}</div>}

      <div className="escrow-notice" style={{ marginTop: '1rem', fontSize: '0.75rem' }}>
        Faucet contract: <span title={FAUCET_ADDRESS}>{FAUCET_ADDRESS.slice(0, 6)}...{FAUCET_ADDRESS.slice(-4)}</span>
      </div>
    </div>
  );
}
