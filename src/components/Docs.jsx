import { ArrowLeft, Zap, Trophy, Shield, Flame, Mail, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

const Section = ({ title, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="docs-section">
      <button className="docs-section-header" onClick={() => setOpen(o => !o)}>
        <h2>{title}</h2>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && <div className="docs-section-body">{children}</div>}
    </div>
  );
};

export default function Docs({ onBack }) {
  return (
    <div className="docs-page">
      <div className="docs-container">

        {/* Header */}
        <div className="docs-header">
          <button className="docs-back-btn" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Game
          </button>
          <div className="docs-title-block">
            <h1>FastFinger Docs</h1>
            <p>Everything you need to know about the game, the RF economy, and policies.</p>
          </div>
        </div>

        {/* How to Play */}
        <Section title="📖 How to Play">
          <div className="docs-steps">
            <div className="docs-step">
              <div className="docs-step-num">1</div>
              <div>
                <strong>Connect your wallet</strong>
                <p>Connect any EVM wallet (MetaMask, Rabby, or any WalletConnect wallet) on Robinhood Chain (chain ID 4663). You need $RAREFRIENDS (RF) for the stake and a little Robinhood ETH for gas. They're different assets.</p>
              </div>
            </div>
            <div className="docs-step">
              <div className="docs-step-num">2</div>
              <div>
                <strong>Choose a pool tier</strong>
                <p>Select your pool tier based on how much RF you want to stake. Tiers range from 🥉 Bronze (10 RF) to 👑 Elite (1,000 RF).</p>
              </div>
            </div>
            <div className="docs-step">
              <div className="docs-step-num">3</div>
              <div>
                <strong>Create or join a match</strong>
                <p>Create a new match and wait for other players, or join an open match. The contract pulls that tier's RF from your wallet via an approval and locks it. The site never holds the tokens.</p>
              </div>
            </div>
            <div className="docs-step">
              <div className="docs-step-num">4</div>
              <div>
                <strong>Play the game</strong>
                <p>When all players join (or the host starts early), a 60-second reaction round begins. Click the targets as fast as possible. Different target types give different points:</p>
                <ul className="docs-target-list">
                  <li><span className="dot purple" /> Normal: 1× points</li>
                  <li><span className="dot amber" /> Fast: 2× points (smaller, faster)</li>
                  <li><span className="dot green" /> Bonus: 3× points (rare, small)</li>
                  <li><span className="dot red" /> Trap: Avoid! Clicking costs you points</li>
                </ul>
                <p>Hit targets quickly for PERFECT (100pts), GOOD (60pts), or OK (30pts) bonuses. Build combos for multipliers: every 5 hits in a row adds 0.5× to your score.</p>
              </div>
            </div>
            <div className="docs-step">
              <div className="docs-step-num">5</div>
              <div>
                <strong>Win the prize pool</strong>
                <p>The player with the highest score wins. If players tie, a rematch starts automatically between the tied players only. Everyone else is out. The winner is declared on-chain within seconds of the game ending.</p>
              </div>
            </div>
            <div className="docs-step">
              <div className="docs-step-num">6</div>
              <div>
                <strong>Claim your prize</strong>
                <p>Winners can claim their RF from the Dashboard page. You receive <strong>90% of the pot</strong>, or <strong>92%</strong> if you own a hardwired Rare Friends Generations NFT (enter its ID when you claim). The rest is burned and streamed to Rare Friends rewards, split evenly. Prizes must be claimed within 7 days.</p>
              </div>
            </div>
          </div>

          <div className="docs-info-box">
            <Shield size={15} />
            <p>All entry fees and prize payouts are handled by a smart contract on Robinhood Chain. FastFinger never holds your funds. The contract does. You can verify all transactions on <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noopener noreferrer">Blockscout</a>.</p>
          </div>
        </Section>

        {/* Pool Tiers */}
        <Section title="💎 Pool Tiers">
          <p className="docs-body-text">Each tier is a fixed RF entry fee. The pot is your tier times the number of players at the table.</p>
          <div className="docs-tier-table-wrap">
          <div className="docs-tier-table">
            <div className="docs-tier-row header">
              <span>Tier</span>
              <span>Entry Fee</span>
              <span>2-player pot</span>
              <span>Winner (90%)</span>
            </div>
            {[
              { icon: '🥉', name: 'Bronze',   rf: '10 RF',    pot: '20 RF',    win: '18 RF' },
              { icon: '🥈', name: 'Silver',   rf: '25 RF',    pot: '50 RF',    win: '45 RF' },
              { icon: '🥇', name: 'Gold',     rf: '50 RF',    pot: '100 RF',   win: '90 RF' },
              { icon: '💎', name: 'Platinum', rf: '100 RF',   pot: '200 RF',   win: '180 RF' },
              { icon: '💠', name: 'Diamond',  rf: '250 RF',   pot: '500 RF',   win: '450 RF' },
              { icon: '👑', name: 'Elite',    rf: '1,000 RF', pot: '2,000 RF', win: '1,800 RF' },
            ].map(t => (
              <div key={t.name} className="docs-tier-row">
                <span>{t.icon} {t.name}</span>
                <span>{t.rf}</span>
                <span>{t.pot}</span>
                <span>{t.win}</span>
              </div>
            ))}
          </div>
          </div>

          <div className="docs-info-box">
            <Trophy size={15} />
            <p>A full table multiplies the pot: ten players at Elite stake 10,000 RF, and the winner takes 9,000. Gas (Robinhood ETH) is separate and never part of these numbers.</p>
          </div>
        </Section>

        {/* Burn & rewards */}
        <Section title="🔥 Burn, Rewards & the Friend Bonus">
          <p className="docs-body-text">FastFinger doesn't mint a second token. Every settled match destroys RF and feeds the existing Rare Friends reward stream, on top of the official 50/50 burn-and-rewards rule described at <a href="https://rarefriends.com/docs/rarefriends" target="_blank" rel="noopener noreferrer">rarefriends.com</a>.</p>
          <div className="docs-info-box">
            <Flame size={15} />
            <p><strong>10% rake, split evenly:</strong> 5% is burned forever (RF supply only ever goes down), 5% streams to active Rare Friends holders. The winner keeps the other 90%.</p>
          </div>
          <div className="docs-info-box">
            <Zap size={15} />
            <p><strong>Friend bonus:</strong> if the winner owns a hardwired Generations NFT (generation 1 or higher, hardwiring costs as little as 1 RF at Generation 6), the rake drops to 8% and the winner keeps <strong>92%</strong> instead. It's the only way to take a bigger share of the pot, and it gives every hardwired Friend a use outside rarefriends.com.</p>
          </div>
          <p className="docs-body-text">Rewards are never minted. They come out of the rake itself, paid to active Genesis and Generations Friends by weight, exactly as described in the Rare Friends economy docs.</p>
        </Section>

        {/* Cancellation */}
        <Section title="↩ Cancellations & Refunds">
          <p className="docs-body-text">If you create a match and no other player joins, you can cancel and get your full RF stake back on-chain. The Cancel & Get Refund button appears in the matchmaking screen and the lobby while you're the only player.</p>
          <p className="docs-body-text">Once another player joins, the match can't be cancelled and all stakes are locked until a winner is declared. If no winner is declared within 3 days of the table locking (for example, if the game never finishes), anyone can trigger a full refund to every player in that match.</p>
          <p className="docs-body-text">Prizes must be claimed within 7 days of the match ending. Unclaimed prizes after 7 days are swept: burned and sent to Rare Friends rewards, the same 50/50 split as an unclaimed sweep, and are not kept by FastFinger.</p>
        </Section>

        {/* Terms */}
        <Section title="📜 Terms of Service">
          <p className="docs-body-text">Last updated: {new Date().getFullYear()}</p>
          <p className="docs-body-text">By using FastFinger you agree to these terms. Please read them carefully.</p>
          <h3 className="docs-h3">1. Eligibility</h3>
          <p className="docs-body-text">You must be of legal age in your jurisdiction to participate in games involving real value. You are responsible for ensuring that participating in skill-based wagering games is legal where you live.</p>
          <h3 className="docs-h3">2. Nature of the Game</h3>
          <p className="docs-body-text">FastFinger is a skill-based reaction game. Winners are determined purely by performance (score), not by chance. All matches are conducted fairly and transparently on Robinhood Chain.</p>
          <h3 className="docs-h3">3. Smart Contract</h3>
          <p className="docs-body-text">Entry fees and prize distributions are handled by an auditable smart contract on Robinhood Chain. FastFinger cannot alter, freeze, or redirect funds held by the contract outside of normal game operations, and never holds a private key that can move staked RF.</p>
          <h3 className="docs-h3">4. Rake</h3>
          <p className="docs-body-text">A 10% rake (8% with a hardwired Generations Friend) is automatically deducted from the prize pool upon claim, split evenly between a permanent burn and Rare Friends rewards. FastFinger does not collect a platform fee from matches.</p>
          <h3 className="docs-h3">5. Prohibited Conduct</h3>
          <p className="docs-body-text">You may not use bots, scripts, or any automated tools to play the game. Suspected exploits or cheating will result in score invalidation. FastFinger uses server-side validation to detect suspicious activity.</p>
          <h3 className="docs-h3">6. Disclaimer</h3>
          <p className="docs-body-text">FastFinger is provided as-is. We are not responsible for losses resulting from network issues, wallet errors, or smart contract bugs. Always verify transactions on Blockscout before signing.</p>
        </Section>

        {/* Privacy */}
        <Section title="🔒 Privacy Policy">
          <p className="docs-body-text">Last updated: {new Date().getFullYear()}</p>
          <h3 className="docs-h3">What we collect</h3>
          <p className="docs-body-text">We collect your wallet address (public on-chain), game scores, and match history. We do not collect your name, email, or any personally identifiable information unless you contact us directly.</p>
          <h3 className="docs-h3">How we use it</h3>
          <p className="docs-body-text">Your wallet address and game data are used to display your stats and leaderboard position. This data is stored in our database and associated with your wallet address.</p>
          <h3 className="docs-h3">On-chain data</h3>
          <p className="docs-body-text">All transactions on Robinhood Chain are public and permanent. Entry fees, prize claims, and match results are visible on Blockscout to anyone.</p>
          <h3 className="docs-h3">Third parties</h3>
          <p className="docs-body-text">We use Supabase for database storage and Vercel for hosting. We do not sell your data to advertisers or third parties.</p>
          <h3 className="docs-h3">Cookies</h3>
          <p className="docs-body-text">We use localStorage to remember your theme preference (dark/light mode) and whether you have completed the onboarding tour. No tracking cookies are used.</p>
        </Section>

        {/* Contact */}
        <Section title="📬 Contact Us">
          <p className="docs-body-text">Have a question, bug report, or partnership inquiry? Reach out through any of the channels below.</p>
          <div className="docs-contact-cards">
            <a href="mailto:fastfingerclub@gmail.com" className="docs-contact-card">
              <Mail size={22} />
              <div>
                <strong>Email</strong>
                <span>fastfingerclub@gmail.com</span>
              </div>
            </a>
            <a href="https://x.com/fastfingerclub" target="_blank" rel="noopener noreferrer" className="docs-contact-card">
              <X size={22} />
              <div>
                <strong>X</strong>
                <span>@fastfingerclub</span>
              </div>
            </a>
          </div>
        </Section>

        <div className="docs-footer-note">
          © {new Date().getFullYear()} FastFinger. Built on Robinhood Chain.
        </div>
      </div>
    </div>
  );
}
