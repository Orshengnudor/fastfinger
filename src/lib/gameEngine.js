// FastFinger - Reaction Game Engine (Polished Competitive Version)

const ROUND_DURATION = 60;

const SPAWN_INTERVAL_MIN = 180;   // Fast but fair
const SPAWN_INTERVAL_MAX = 520;
const TARGET_LIFETIME = 1350;     // Quick targets = high pressure
const MAX_TARGETS_ON_SCREEN = 7;

const PERFECT_THRESHOLD = 240;
const GOOD_THRESHOLD = 480;

const MIN_REACTION_TIME = 75;     // Anti-bot
const MAX_CLICKS_PER_SECOND = 11; // Allow skilled players but block macros

const SCORE_PERFECT = 100;
const SCORE_GOOD = 50;
const SCORE_OK = 25;
const SCORE_MISS = -10;

const TARGET_TYPES = [
  { type: 'normal', color: '#ccff00', points: 1, chance: 0.45, size: 48 },
  { type: 'fast',   color: '#f59e0b', points: 2, chance: 0.27, size: 38 },
  { type: 'bonus',  color: '#22d3ee', points: 3, chance: 0.17, size: 34 },
  { type: 'trap',   color: '#ef4444', points: -2, chance: 0.11, size: 52 },
];

export const createGameState = () => ({
  targets: [],
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  misses: 0,
  perfectHits: 0,
  totalReactionTime: 0,
  timeLeft: ROUND_DURATION,
  isActive: false,
  round: 1,
  nextTargetId: 0,
  clickTimestamps: [],
  suspiciousActions: 0,
});

export const getTargetType = () => {
  const roll = Math.random();
  let cumulative = 0;
  for (const t of TARGET_TYPES) {
    cumulative += t.chance;
    if (roll <= cumulative) return t;
  }
  return TARGET_TYPES[0];
};

export const spawnTarget = (gameState, areaWidth, areaHeight) => {
  if (gameState.targets.length >= MAX_TARGETS_ON_SCREEN) return null;

  const targetType = getTargetType();
  const padding = 12;
  const x = padding + Math.random() * (areaWidth - targetType.size - padding * 2);
  const y = padding + Math.random() * (areaHeight - targetType.size - padding * 2);

  return {
    id: gameState.nextTargetId++,
    x,
    y,
    ...targetType,
    spawnedAt: Date.now(),
    lifetime: TARGET_LIFETIME + Math.random() * 250,
  };
};

export const hitTarget = (gameState, targetId) => {
  const target = gameState.targets.find(t => t.id === targetId);
  if (!target) return { ...gameState };

  const now = Date.now();
  const reactionTime = now - target.spawnedAt;

  // Anti-exploit checks
  if (reactionTime < MIN_REACTION_TIME) {
    gameState.suspiciousActions++;
    return { ...gameState };
  }

  gameState.clickTimestamps = gameState.clickTimestamps.filter(t => now - t < 1000);
  if (gameState.clickTimestamps.length >= MAX_CLICKS_PER_SECOND) {
    gameState.suspiciousActions++;
    return { ...gameState };
  }
  gameState.clickTimestamps.push(now);

  let scoreGain;
  let hitQuality;

  if (target.type === 'trap') {
    scoreGain = SCORE_MISS * 2;
    hitQuality = 'trap';
    gameState.combo = 0;
  } else if (reactionTime <= PERFECT_THRESHOLD) {
    scoreGain = SCORE_PERFECT * target.points;
    hitQuality = 'perfect';
    gameState.combo++;
    gameState.perfectHits++;
  } else if (reactionTime <= GOOD_THRESHOLD) {
    scoreGain = SCORE_GOOD * target.points;
    hitQuality = 'good';
    gameState.combo++;
  } else {
    scoreGain = SCORE_OK * target.points;
    hitQuality = 'ok';
    gameState.combo++;
  }

  const comboMultiplier = 1 + Math.floor(gameState.combo / 5) * 0.5;
  scoreGain = Math.round(scoreGain * comboMultiplier);

  gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
  gameState.score = Math.max(0, gameState.score + scoreGain);
  gameState.hits++;
  gameState.totalReactionTime += reactionTime;
  gameState.targets = gameState.targets.filter(t => t.id !== targetId);

  return {
    ...gameState,
    lastHit: {
      quality: hitQuality,
      score: scoreGain,
      reactionTime,
      combo: gameState.combo,
      x: target.x + target.size / 2,
      y: target.y,
    },
  };
};

export const removeExpiredTargets = (gameState) => {
  const now = Date.now();
  const expired = gameState.targets.filter(t => now - t.spawnedAt > t.lifetime);

  if (expired.length > 0) {
    gameState.misses += expired.filter(t => t.type !== 'trap').length;
    gameState.combo = 0;
    gameState.targets = gameState.targets.filter(t => now - t.spawnedAt <= t.lifetime);
  }

  return gameState;
};

// Dynamic spawn rate - gets faster toward the end
export const getRandomSpawnInterval = (timeLeft = ROUND_DURATION) => {
  const urgency = Math.max(0.35, timeLeft / ROUND_DURATION);
  const min = SPAWN_INTERVAL_MIN * urgency;
  const max = SPAWN_INTERVAL_MAX * urgency;
  return min + Math.random() * (max - min);
};

export const calculateAccuracy = (gameState) => {
  const total = gameState.hits + gameState.misses;
  if (total === 0) return 0;
  return Math.round((gameState.hits / total) * 100);
};

export const getAvgReactionTime = (gameState) => {
  if (gameState.hits === 0) return 0;
  return Math.round(gameState.totalReactionTime / gameState.hits);
};

export const ROUND_DURATION_SEC = ROUND_DURATION;