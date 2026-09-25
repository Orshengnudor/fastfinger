import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { getOpenMatches, createMatch, joinMatch, subscribeToLobby, supabase } from '../lib/supabase';
import {
  formatWallet, getRfBalance, getEthBalance, validateEntryBalance, previewSplit, previewEliminationSplit,
  createMatchOnChain, joinMatchOnChain, cancelMatchOnChain,
  ENTRY_TIERS, getTierByIndex, PLAYER_OPTIONS, PLAYER_OPTIONS_ELIMINATION,
} from '../lib/blockchain';
import { Users, Zap, Plus, ArrowRight, Shield, Wallet, AlertCircle, Flame, RefreshCw, XCircle, Swords } from 'lucide-react';

export default function Lobby({ onJoinMatch }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient }   = useWalletClient();

  const [matches,      setMatches]      = useState([]);
  const [creating,     setCreating]     = useState(false);
  const [joining,      setJoining]      = useState(null);
  const [cancelling,   setCancelling]   = useState(null);
  const [mode,         setMode]         = useState('standard'); // 'standard' | 'elimination'
  const [maxPlayers,   setMaxPlayers]   = useState(2);
  const [selectedTier, setSelectedTier] = useState(0);
  const [rfBalance,    setRfBalance]    = useState(0);
  const [ethBalance,   setEthBalance]   = useState(0);
  const [error,        setError]        = useState('');
  const [txStatus,     setTxStatus]     = useState('');
  const [refreshing,   setRefreshing]   = useState(false);

  const pollRef = useRef(null);
  const currentTier = getTierByIndex(selectedTier);
  const pool = currentTier.rf * maxPlayers;
  const { payout } = previewSplit(pool, false);
  const { payout: friendPayout } = previewSplit(pool, true);
  const elimSplit = previewEliminationSplit(pool);
  const playerOptions = mode === 'elimination' ? PLAYER_OPTIONS_ELIMINATION : PLAYER_OPTIONS;

  const handleModeChange = (next) => {
    setMode(next);
    // Elimination only exists for 5+ tables — jump to the smallest valid one
    // rather than leaving a now-invalid player count selected.
    if (next === 'elimination' && !PLAYER_OPTIONS_ELIMINATION.includes(maxPlayers)) {
      setMaxPlayers(PLAYER_OPTIONS_ELIMINATION[0]);
    }
  };

  const loadMatches = useCallback(async () => {
    try {
      const data = await getOpenMatches();
      setMatches(data || []);
    } catch (err) {
      console.error('Failed to load matches:', err);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMatches();
    setTimeout(() => setRefreshing(false), 600);
  };

  useEffect(() => { loadMatches(); }, [isConnected, address, loadMatches]);

  useEffect(() => {
    const channel = subscribeToLobby(() => loadMatches());
    pollRef.current = setInterval(loadMatches, 5000);
    return () => {
      channel.unsubscribe();
      clearInterval(pollRef.current);
    };
  }, [loadMatches]);

  useEffect(() => {
    if (!address) return;
    getRfBalance(address).then(setRfBalance);
    getEthBalance(address).then(setEthBalance);
  }, [address]);

  const refreshBalances = () => {
    if (!address) return;
    getRfBalance(address).then(setRfBalance);
    getEthBalance(address).then(setEthBalance);
  };

  const handleCreate = async () => {
    if (!address || !walletClient) return;
    setError('');
    setTxStatus('');
    setCreating(true);
    try {
      const validation = await validateEntryBalance(address, selectedTier);
      if (!validation.hasEnough) {
        setError(`Insufficient RF. Need ${validation.required} RF, you have ${validation.balance.toFixed(2)} RF.`);
        setCreating(false);
        return;
      }

      const matchId = crypto.randomUUID();
      const result = await createMatchOnChain(walletClient, matchId, maxPlayers, selectedTier, setTxStatus, mode);
      if (!result.success) {
        setError(result.error || 'Transaction failed.');
        setCreating(false);
        setTxStatus('');
        return;
      }

      setTxStatus('Creating match record...');
      const match = await createMatch(address, currentTier.rf, maxPlayers, selectedTier, matchId, mode);
      setTxStatus('Match created! ✅');
      setTimeout(() => setTxStatus(''), 2500);
      refreshBalances();
      await loadMatches();
      onJoinMatch(match);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create match');
    }
    setCreating(false);
    setTxStatus('');
  };

  const handleJoin = async (match) => {
    if (!address || !walletClient) return;
    setError('');
    setJoining(match.id);
    try {
      const tierIndex = match.tier ?? 0;
      const validation = await validateEntryBalance(address, tierIndex);
      if (!validation.hasEnough) {
        setError(`Need ${validation.required} RF to join. You have ${validation.balance.toFixed(2)} RF.`);
        setJoining(null);
        return;
      }

      const result = await joinMatchOnChain(walletClient, match.id, tierIndex, setTxStatus, match.mode || 'standard');
      if (!result.success) {
        setError(result.error || 'Transaction failed.');
        setJoining(null);
        setTxStatus('');
        return;
      }

      await joinMatch(match.id, address);
      setTxStatus('Joined! ✅');
      setTimeout(() => setTxStatus(''), 2000);
      refreshBalances();
      await loadMatches();

      const { data: updatedMatch } = await supabase
        .from('matches').select('*').eq('id', match.id).single();
      onJoinMatch(updatedMatch || match);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to join match');
    }
    setJoining(null);
    setTxStatus('');
  };

  // Cancelling a solo match must release the on-chain stake, not just flip the
  // Supabase row — otherwise the RF stays locked in the escrow with nothing to
  // show it in the lobby.
  const handleCancel = async (match) => {
    if (!address || !walletClient) return;
    setCancelling(match.id);
    setError('');
    try {
      const result = await cancelMatchOnChain(walletClient, match.id, match.mode || 'standard');
      if (!result.success) {
        setError(result.error || 'Cancellation failed.');
        setCancelling(null);
        return;
      }
      await supabase.from('matches')
        .update({ status: 'cancelled' })
        .eq('id', match.id)
        .eq('host_wallet', address);
      refreshBalances();
      await loadMatches();
    } catch (err) {
      setError(err.message || 'Failed to cancel match');
    }
    setCancelling(null);
  };

  if (!isConnected) {
    return (
      <div className="lobby-connect">
        <div className="hero-section">
          <img src="/logo-mark.png" alt="" className="hero-mark pixel-mark" />
          <h1>FastFinger</h1>
          <p className="hero-subtitle">Skill. Stake. Burn. On Robinhood Chain.</p>
          <p className="hero-desc">
            Stake $RAREFRIENDS, beat the table in a 60-second reaction round, and
            take the pot. Every match burns RF and funds active Rare Friends.
          </p>
          <div className="features-grid">
            <div className="feature-card"><Zap size={22} /><span>Win RF</span></div>
            <div className="feature-card"><Users size={22} /><span>2–10 Players</span></div>
            <div className="feature-card"><Flame size={22} /><span>Burns Supply</span></div>
            <div className="feature-card"><Shield size={22} /><span>Smart Contract</span></div>
          </div>
          <div className="points-notice">
            🔥 Hold a hardwired Generations Friend → keep 92% instead of 90% (standard mode)
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
            <ConnectKitButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <div className="lobby-header">
        <h2>Game Lobby</h2>
        <p>Stake RF • Beat the table • Burn supply</p>
        <div className="sol-balance-badge">
          <Wallet size={13} /> {rfBalance.toFixed(2)} RF
        </div>
        <div className="gas-balance-note">{ethBalance.toFixed(5)} ETH for gas</div>
      </div>

      {error    && <div className="lobby-error"><AlertCircle size={15} /> {error}</div>}
      {txStatus && <div className="tx-status">{txStatus}</div>}

      {/* Create Match */}
      <div className="create-match-card">
        <h3><Plus size={17} /> Create Match</h3>

        <div className="option-group">
          <label>Match Type</label>
          <div className="mode-toggle">
            <button className={`mode-opt ${mode === 'standard' ? 'active' : ''}`} onClick={() => handleModeChange('standard')}>
              <Zap size={13} /> Standard
            </button>
            <button className={`mode-opt ${mode === 'elimination' ? 'active' : ''}`} onClick={() => handleModeChange('elimination')}>
              <Swords size={13} /> Elimination
            </button>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            {mode === 'standard'
              ? 'One 60s round, highest score takes the whole pot.'
              : 'Round 1 (5+ players) narrows the field to a final 2 — top 3 overall get paid.'}
          </p>
        </div>

        <div className="option-group">
          <label>Pool Tier & Entry Fee</label>
          <div className="tier-select">
            {ENTRY_TIERS.map(tier => (
              <button
                key={tier.index}
                className={`tier-btn ${selectedTier === tier.index ? 'active' : ''}`}
                onClick={() => setSelectedTier(tier.index)}
              >
                <span className="tier-icon">{tier.icon}</span>
                <span className="tier-sol">{tier.rf} RF</span>
              </button>
            ))}
          </div>
        </div>

        <div className="create-options">
          <div className="option-group">
            <label>Players</label>
            <div className="player-select">
              {playerOptions.map(n => (
                <button
                  key={n}
                  className={`player-opt ${maxPlayers === n ? 'active' : ''}`}
                  onClick={() => setMaxPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="option-group">
            <label>Your Entry</label>
            <div className="fee-display">{currentTier.rf} RF</div>
          </div>
          <div className="option-group">
            <label>Prize Pool</label>
            <div className="prize-preview">
              🏆 {pool.toLocaleString()} RF
            </div>
          </div>
          {mode === 'standard' ? (
            <div className="option-group">
              <label>Winner Gets</label>
              <div className="points-preview">
                {payout.toLocaleString()} RF <span style={{ opacity: 0.6 }}>({friendPayout.toLocaleString()} with a Friend)</span>
              </div>
            </div>
          ) : (
            <div className="option-group">
              <label>Top 3 Split (60 / 25 / 15)</label>
              <div className="points-preview">
                {elimSplit.first.toLocaleString()} / {elimSplit.second.toLocaleString()} / {elimSplit.third.toLocaleString()} RF
              </div>
            </div>
          )}
        </div>

        {mode === 'standard' ? (
          <div className="escrow-notice">
            🔒 RF locked in a Robinhood Chain smart contract • 10% rake (8% with a hardwired Generations Friend), split evenly between burn and Rare Friends rewards
          </div>
        ) : (
          <div className="escrow-notice">
            🔒 RF locked in a separate elimination-mode smart contract • 10% rake, burned. No Friend bonus in elimination mode yet.
          </div>
        )}

        <button className="create-btn" onClick={handleCreate} disabled={creating}>
          {creating ? (txStatus || 'Creating...') : `Create Match (${currentTier.rf} RF)`}
        </button>
      </div>

      {/* Open Matches */}
      <div className="matches-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3>Open Matches ({matches.length})</h3>
          <button
            onClick={handleRefresh}
            title="Refresh"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem' }}
          >
            <RefreshCw size={15} style={{ animation: refreshing ? 'spin 0.6s linear' : 'none' }} />
            Refresh
          </button>
        </div>

        {matches.length === 0 ? (
          <div className="no-matches">
            <p>No open matches. Create one to start playing!</p>
          </div>
        ) : (
          <div className="matches-list">
            {matches.map(match => {
              const tier       = getTierByIndex(match.tier ?? 0);
              const joined     = match.match_players?.length || match.current_players || 1;
              const remaining  = match.max_players - joined;
              const matchPool  = tier.rf * joined;
              const isHost     = match.host_wallet === address;
              const alreadyIn  = match.match_players?.some(p => p.wallet_address === address);
              const isElim     = match.mode === 'elimination';

              return (
                <div key={match.id} className="match-card">
                  <div className="match-info">
                    <div className="match-host">
                      <span className="tier-badge-sm">{tier.icon} {tier.rf} RF</span>
                      {isElim && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', background: 'rgba(204,255,0,0.15)', color: 'var(--primary-glow)', padding: '2px 6px', borderRadius: '4px' }}>
                          <Swords size={10} style={{ verticalAlign: 'middle' }} /> Elimination
                        </span>
                      )}
                      {' '}Host: {formatWallet(match.host_wallet)}
                      {isHost && (
                        <span style={{ marginLeft: '8px', fontSize: '11px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          Your Match
                        </span>
                      )}
                    </div>
                    <div className="match-details">
                      <span><Users size={13} /> {joined}/{match.max_players}</span>
                      <span className="match-remaining">{remaining} spot{remaining !== 1 ? 's' : ''} left</span>
                      <span>🏆 {matchPool.toLocaleString()} RF{isElim ? ' (top 3 paid)' : ''}</span>
                    </div>
                    <div className="match-progress-bar">
                      <div
                        className="match-progress-fill"
                        style={{ width: `${(joined / match.max_players) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    {isHost && joined <= 1 && (
                      <button
                        style={{ background: 'rgba(255,0,0,0.15)', color: '#ff6666', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', border: '1px solid rgba(255,0,0,0.2)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleCancel(match)}
                        disabled={cancelling === match.id}
                      >
                        <XCircle size={13} /> {cancelling === match.id ? '...' : 'Cancel'}
                      </button>
                    )}
                    <button
                      className="join-btn"
                      onClick={() => handleJoin(match)}
                      disabled={joining === match.id || isHost || alreadyIn}
                    >
                      {joining === match.id
                        ? 'Joining...'
                        : alreadyIn
                          ? 'Joined ✓'
                          : isHost
                            ? 'Your match'
                            : <><span>Join</span> <ArrowRight size={13} /></>}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
