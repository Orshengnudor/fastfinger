import { useState, useEffect, useRef } from 'react';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';

const TOUR_KEY = 'ff-tour-done';

const STEPS = [
  {
    title: 'Welcome to FastFinger ⚡',
    body: 'A real-time multiplayer reaction game on Robinhood Chain. Tap targets faster than your opponents to win the $RAREFRIENDS prize pool.',
    target: null,
    position: 'center',
  },
  {
    title: 'Choose your pool tier',
    body: 'Pick how much RF you want to stake. Higher tiers mean bigger prizes — the whole pot is other players\u2019 RF, minus a rake you can see up front.',
    target: '.tier-select',
    position: 'bottom',
  },
  {
    title: 'Set the number of players',
    body: 'Choose 2 to 10 players per match. More players = bigger prize pool.',
    target: '.player-select',
    position: 'bottom',
  },
  {
    title: 'Create or join a match',
    body: 'Create your own match and wait for opponents, or join an open match from the list below.',
    target: '.create-btn',
    position: 'top',
  },
  {
    title: 'Your RF balance',
    body: 'Your $RAREFRIENDS balance shows here. Make sure you have enough RF for your chosen tier, plus a little Robinhood ETH for gas — they\u2019re separate assets.',
    target: '.sol-balance-badge',
    position: 'bottom',
  },
  {
    title: 'Open matches',
    body: 'Active matches waiting for players appear here. Join any that match your budget and preferred tier.',
    target: '.matches-section',
    position: 'top',
  },
  {
    title: 'Hardwire a Friend for a bigger cut',
    body: 'Own a hardwired Rare Friends Generations NFT? Enter its ID when you claim to keep 92% of the pot instead of 90%. Every match burns RF either way.',
    target: null,
    position: 'center',
  },
  {
    title: 'Check your Dashboard',
    body: 'After winning, go to Dashboard to claim your RF prize. Winners must claim within 7 days.',
    target: '[data-tour="dashboard-btn"]',
    position: 'bottom',
  },
  {
    title: "You're ready to play! 🏆",
    body: 'Connect your wallet, pick a tier, and start competing. Good luck!',
    target: null,
    position: 'center',
  },
];

function getElementRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top:    rect.top    + window.scrollY,
    left:   rect.left   + window.scrollX,
    width:  rect.width,
    height: rect.height,
    bottom: rect.top    + window.scrollY + rect.height,
    right:  rect.left   + window.scrollX + rect.width,
  };
}

export default function OnboardingTour({ onDone }) {
  const [step,    setStep]    = useState(0);
  const [rect,    setRect]    = useState(null);
  const [visible, setVisible] = useState(false);
  const tooltipRef = useRef(null);

  const current = STEPS[step];

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const r = getElementRect(current.target);
    setRect(r);
  }, [step, visible]);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      finish();
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(s => s - 1);
  };

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    onDone();
  };

  if (!visible) return null;

  // Tooltip positioning
  const PAD = 12;
  let tooltipStyle = {};

  if (current.position === 'center' || !rect) {
    tooltipStyle = {
      position: 'fixed',
      top:  '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 10001,
    };
  } else if (current.position === 'bottom') {
    tooltipStyle = {
      position: 'absolute',
      top:  rect.bottom + PAD,
      left: Math.max(12, rect.left),
      zIndex: 10001,
    };
  } else {
    tooltipStyle = {
      position: 'absolute',
      top:  rect.top - PAD - 180,
      left: Math.max(12, rect.left),
      zIndex: 10001,
    };
  }

  return (
    <>
      {/* Dark overlay */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 10000,
          pointerEvents: 'none',
        }}
      />

      {/* Highlight box around target */}
      {rect && (
        <div
          style={{
            position:     'absolute',
            top:          rect.top    - 6,
            left:         rect.left   - 6,
            width:        rect.width  + 12,
            height:       rect.height + 12,
            borderRadius: 10,
            border:       '2px solid hsl(75, 100%, 55%)',
            boxShadow:    '0 0 0 4px hsla(75,100%,55%,0.2)',
            zIndex:       10000,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        style={{
          ...tooltipStyle,
          background:   'var(--bg-card, #16161a)',
          border:       '1px solid hsl(75,60%,35%)',
          borderRadius: 14,
          padding:      '1.25rem 1.4rem',
          width:        320,
          maxWidth:     'calc(100vw - 24px)',
          boxShadow:    '0 8px 40px rgba(0,0,0,0.5)',
          color:        'var(--text-primary, #f7f7f7)',
        }}
      >
        {/* Step indicator */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  width:        i === step ? 18 : 6,
                  height:       6,
                  borderRadius: 3,
                  background:   i === step
                    ? 'hsl(75,100%,55%)'
                    : 'hsla(75,100%,55%,0.3)',
                  transition:   'all 0.3s',
                }}
              />
            ))}
          </div>
          <button
            onClick={finish}
            style={{
              background: 'none', border: 'none',
              color: 'var(--text-muted, #888)',
              cursor: 'pointer', padding: '2px 4px',
              display: 'flex', alignItems: 'center',
            }}
            title="Skip tour"
          >
            <X size={16} />
          </button>
        </div>

        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary, #f7f7f7)' }}>
          {current.title}
        </h3>
        <p style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-secondary, #aaa)', marginBottom: '1.1rem' }}>
          {current.body}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handleBack}
            disabled={step === 0}
            style={{
              background: 'none',
              border: '1px solid hsla(75,20%,40%,0.5)',
              color: step === 0 ? 'transparent' : 'var(--text-muted, #888)',
              borderColor: step === 0 ? 'transparent' : undefined,
              borderRadius: 8,
              padding: '0.45rem 0.85rem',
              cursor: step === 0 ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: '0.82rem',
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>

          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #888)' }}>
            {step + 1} / {STEPS.length}
          </span>

          <button
            onClick={handleNext}
            style={{
              background:   'linear-gradient(135deg, hsl(75,100%,50%), hsl(70,90%,42%))',
              border:       'none',
              color:        '#0d0d0f',
              borderRadius: 8,
              padding:      '0.45rem 1rem',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          4,
              fontSize:     '0.85rem',
              fontWeight:   700,
            }}
          >
            {step === STEPS.length - 1 ? "Let's play!" : 'Next'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

export const shouldShowTour = () => !localStorage.getItem(TOUR_KEY);
