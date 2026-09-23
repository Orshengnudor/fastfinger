-- FastFinger / Robinhood Chain migration
-- Run this against the existing Supabase project. Safe on an empty table set
-- (fresh project) and on one with existing legacy rows (maps old string
-- tier keys to the new numeric tier index used by FastFingerEscrow.tierEntry).

-- ─── matches.tier: 'bronze'..'elite' (text) → 0..5 (smallint) ─────────────────
alter table matches
  alter column tier drop default;

alter table matches
  alter column tier type smallint
  using (
    case tier
      when 'bronze'   then 0
      when 'silver'   then 1
      when 'gold'     then 2
      when 'platinum' then 3
      when 'diamond'  then 4
      when 'elite'    then 5
      else coalesce(nullif(tier, '')::smallint, 0)
    end
  );

alter table matches
  alter column tier set default 0;

-- ─── leaderboard: drop the $HERO points system, track RF actually won ────────
alter table leaderboard
  rename column total_eth_won to total_rf_won;

alter table leaderboard
  drop column if exists total_points,
  drop column if exists total_score;

comment on column leaderboard.total_rf_won is
  'Sum of RF actually received on claimPrize (90% or 92% of each won pot), not the raw pot.';
