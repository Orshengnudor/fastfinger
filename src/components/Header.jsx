import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Trophy, Sun, Moon, LayoutDashboard, Wallet, Zap, Crown, Menu } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { getRfBalance } from '../lib/blockchain';

export default function Header({ activeView, setActiveView, prizePool, isDarkMode, toggleDarkMode }) {
  const { address, isConnected } = useAccount();
  const [rfBalance, setRfBalance] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    if (!address) return;
    getRfBalance(address).then(setRfBalance);
  }, [address]);

  // Close the mobile "More" dropdown on an outside click.
  useEffect(() => {
    if (!showMore) return;
    const onClick = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showMore]);

  const goTo = (view) => {
    setActiveView(view);
    setShowMore(false);
  };

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
          onClick={() => goTo('lobby')}
        >
          Lobby
        </button>
        <button
          className={`nav-btn ${activeView === 'practice' ? 'active' : ''}`}
          onClick={() => goTo('practice')}
        >
          <Zap size={14} /> Practice
        </button>
        <button
          data-tour="dashboard-btn"
          className={`nav-btn ${activeView === 'dashboard' ? 'active' : ''}`}
          onClick={() => goTo('dashboard')}
        >
          <LayoutDashboard size={14} /> Dashboard
        </button>

        {/* Ranks/Season: inline on desktop (room for everything), tucked
            behind a "More" dropdown on mobile — which of the two shows is
            purely CSS (.nav-desktop-extra / .nav-more), no JS breakpoint
            detection needed. */}
        <span className="nav-desktop-extra">
          <button
            className={`nav-btn ${activeView === 'leaderboard' ? 'active' : ''}`}
            onClick={() => goTo('leaderboard')}
          >
            <Trophy size={14} /> Ranks
          </button>
          <button
            className={`nav-btn ${activeView === 'season' ? 'active' : ''}`}
            onClick={() => goTo('season')}
          >
            <Crown size={14} /> Season
          </button>
        </span>

        <div className="nav-more" ref={moreRef}>
          <button
            className={`nav-btn nav-more-btn ${activeView === 'leaderboard' || activeView === 'season' ? 'active' : ''}`}
            onClick={() => setShowMore(v => !v)}
            aria-label="More"
          >
            <Menu size={14} /> More
          </button>
          {showMore && (
            <div className="nav-more-dropdown">
              <button
                className={`nav-more-item ${activeView === 'leaderboard' ? 'active' : ''}`}
                onClick={() => goTo('leaderboard')}
              >
                <Trophy size={14} /> Ranks
              </button>
              <button
                className={`nav-more-item ${activeView === 'season' ? 'active' : ''}`}
                onClick={() => goTo('season')}
              >
                <Crown size={14} /> Season
              </button>
            </div>
          )}
        </div>
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
