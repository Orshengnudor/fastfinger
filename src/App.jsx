import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import WalletProvider from './components/WalletProvider';
import Header from './components/Header';
import Lobby from './components/Lobby';
import PracticeMode from './components/PracticeMode';
import Matchmaking from './components/Matchmaking';
import GamePlay from './components/GamePlay';
import EliminationFlow from './components/EliminationFlow';
import GameResults from './components/GameResults';
import Leaderboard from './components/Leaderboard';
import SeasonPool from './components/SeasonPool';
import Dashboard from './components/Dashboard';
import Docs from './components/Docs';
import OnboardingTour, { shouldShowTour } from './components/OnboardingTour';
import { recordGameResult, getMyActiveMatch, getMatchPlayers } from './lib/supabase';
import './App.css';

function GameApp() {
  const { address, isConnected } = useAccount();

  const [activeView,   setActiveView]   = useState('lobby');
  const [currentMatch, setCurrentMatch] = useState(null);
  const [matchPlayers, setMatchPlayers] = useState([]);
  const [gameResults,  setGameResults]  = useState(null);
  const [prizePool,    setPrizePool]    = useState(0);
  const [showTour,     setShowTour]     = useState(false);
  const [rejoinMatch,  setRejoinMatch]  = useState(null); // banner data
  const [isDarkMode,   setIsDarkMode]   = useState(() => localStorage.getItem('ff-theme') !== 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem('ff-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    if (activeView === 'lobby' && shouldShowTour()) {
      const t = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(t);
    }
  }, [activeView]);

  // Check for active match when wallet connects.
  // Only show banner if match is still waiting or in_progress AND
  // the user is not already in matchmaking or game view.
  useEffect(() => {
    if (!address || !isConnected) { setRejoinMatch(null); return; }
    if (activeView === 'matchmaking' || activeView === 'game' || activeView === 'results') return;

    getMyActiveMatch(address).then(m => {
      if (!m) { setRejoinMatch(null); return; }
      // Don't show if the match finished or was cancelled
      if (!['waiting', 'starting', 'in_progress'].includes(m.status)) {
        setRejoinMatch(null);
        return;
      }
      setRejoinMatch(m);
    });
  }, [address, isConnected, activeView]);

  const handleRejoin = async () => {
    if (!rejoinMatch) return;
    const players = await getMatchPlayers(rejoinMatch.id);
    setCurrentMatch(rejoinMatch);
    setMatchPlayers(players);
    setPrizePool(rejoinMatch.prize_pool || 0);
    setRejoinMatch(null);
    // If game already started, go straight to game view
    setActiveView(rejoinMatch.status === 'in_progress' ? 'game' : 'matchmaking');
  };

  const handleJoinMatch = (match) => {
    setCurrentMatch(match);
    setPrizePool(match.prize_pool || match.entry_fee);
    setRejoinMatch(null);
    setActiveView('matchmaking');
  };

  const handleGameStart = (match, players) => {
    setCurrentMatch(match);
    setMatchPlayers(players);
    setPrizePool(match.prize_pool || match.entry_fee);
    setActiveView('game');
  };

  const handleGameEnd = async (results) => {
    setGameResults(results);
    setActiveView('results');
    if (address) {
      const won = results.mode === 'elimination' ? results.place === 1 : results.winner === address;
      await recordGameResult(address, won);
    }
  };

  const handleBackToLobby = () => {
    setCurrentMatch(null);
    setMatchPlayers([]);
    setGameResults(null);
    setPrizePool(0);
    setActiveView('lobby');
  };

  const handleLeaveMatch = () => {
    setCurrentMatch(null);
    setPrizePool(0);
    setActiveView('lobby');
  };

  if (activeView === 'docs') {
    return <Docs onBack={() => setActiveView('lobby')} />;
  }

  const renderView = () => {
    switch (activeView) {
      case 'lobby':       return <Lobby onJoinMatch={handleJoinMatch} />;
      case 'practice':    return <PracticeMode onBack={() => setActiveView('lobby')} />;
      case 'matchmaking': return <Matchmaking match={currentMatch} onGameStart={handleGameStart} onLeave={handleLeaveMatch} />;
      case 'game':        return currentMatch?.mode === 'elimination'
        ? <EliminationFlow match={currentMatch} players={matchPlayers} onGameEnd={handleGameEnd} />
        : <GamePlay match={currentMatch} players={matchPlayers} onGameEnd={handleGameEnd} />;
      case 'results':
        return (
          <GameResults
            results={gameResults}
            match={currentMatch}
            onBackToLobby={handleBackToLobby}
          />
        );
      case 'leaderboard': return <Leaderboard />;
      case 'season':      return <SeasonPool />;
      case 'dashboard':   return <Dashboard />;
      default:            return <Lobby onJoinMatch={handleJoinMatch} />;
    }
  };

  return (
    <div className="app-container">
      <Header
        activeView={activeView}
        setActiveView={setActiveView}
        prizePool={prizePool}
        isDarkMode={isDarkMode}
        toggleDarkMode={() => setIsDarkMode(p => !p)}
      />

      {/* Rejoin banner - only shown when user has an active unfinished match */}
      {rejoinMatch && activeView !== 'matchmaking' && activeView !== 'game' && activeView !== 'results' && (
        <div className="rejoin-banner">
          <span>
            {rejoinMatch.status === 'in_progress'
              ? 'A game is in progress that you are part of!'
              : `Your match is waiting: ${rejoinMatch.max_players - (rejoinMatch.current_players || 1)} spot${rejoinMatch.max_players - (rejoinMatch.current_players || 1) !== 1 ? 's' : ''} left`}
          </span>
          <button onClick={handleRejoin} className="rejoin-btn">
            {rejoinMatch.status === 'in_progress' ? 'Rejoin Game' : 'Continue to Match'}
          </button>
          <button onClick={() => setRejoinMatch(null)} className="rejoin-dismiss">✕</button>
        </div>
      )}

      <main className="app-main">{renderView()}</main>

      <footer className="app-footer">
        <div className="footer-links">
          <button onClick={() => setActiveView('docs')}>Docs</button>
          <button onClick={() => setActiveView('docs')}>How to Play</button>
          <button onClick={() => setActiveView('docs')}>Terms</button>
          <button onClick={() => setActiveView('docs')}>Privacy</button>
          <a href="mailto:fastfingerclub@gmail.com">Contact</a>
          <a href="https://x.com/fastfingerclub" target="_blank" rel="noopener noreferrer">X / Twitter</a>
        </div>
        <div className="footer-copy">
          © {new Date().getFullYear()} FastFinger • Built on Robinhood Chain •{' '}
          <button className="footer-tour-btn" onClick={() => setShowTour(true)}>Replay Tutorial</button>
        </div>
      </footer>

      {showTour && activeView === 'lobby' && <OnboardingTour onDone={() => setShowTour(false)} />}
    </div>
  );
}

export default function App() {
  return <WalletProvider><GameApp /></WalletProvider>;
}
