import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Trophy, Sun, Moon, LayoutDashboard, Wallet, Zap, Crown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getRfBalance } from '../lib/blockchain';

export default function Header({ activeView, setActiveView, prizePool, isDarkMode, toggleDarkMode }) {
  const { address, isConnected } = useAccount();
  const [rfBalance, setRfBalance] = useState(0);

  useEffect(() => {
    if (!address) return;
    getRfBalance(address).then(setRfBalance);
  }, [address]);

  return (
    <header className="game-header">
      <div className="header-left">
        <img
          src="/logo-mark.png"
          alt="FastFinger"
          className="header-logo-img pixel-mark"
          onError={e => { e.target.style.display = 'none'; }}
        />
        <h1 className="header-title">FastFinger</h1>
      </div>

      <nav className="header-nav">
        <button
          className={`nav-btn ${activeView === 'lobby' ? 'active' : ''}`}
          onClick={() => setActiveView('lobby')}
        >
          Lobby
        </button>
        <button
          className={`nav-btn ${activeView === 'practice' ? 'active' : ''}`}
          onClick={() => setActiveView('practice')}
        >
          <Zap size={14} /> Practice
        </button>
        <button
          data-tour="dashboard-btn"
          className={`nav-btn ${activeView === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveView('dashboard')}
        >
          <LayoutDashboard size={14} /> Dashboard
        </button>
        <button
          className={`nav-btn ${activeView === 'leaderboard' ? 'active' : ''}`}
          onClick={() => setActiveView('leaderboard')}
        >
          <Trophy size={14} /> Ranks
        </button>
        <button
          className={`nav-btn ${activeView === 'season' ? 'active' : ''}`}
          onClick={() => setActiveView('season')}
        >
          <Crown size={14} /> Season
        </button>
      </nav>

      <div className="header-right">
        {prizePool > 0 && (
          <div className="prize-badge">
            🏆 {parseFloat(prizePool).toFixed(2)} RF
          </div>
        )}

        {isConnected && (
          <div className="points-badge" title="Your $RAREFRIENDS balance">
            <Wallet size={13} /> {rfBalance.toFixed(2)} RF
          </div>
        )}

        <button
          onClick={toggleDarkMode}
          className="dark-toggle-btn"
          title={isDarkMode ? 'Light mode' : 'Dark mode'}
        >
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <ConnectKitButton />
      </div>
    </header>
  );
}
