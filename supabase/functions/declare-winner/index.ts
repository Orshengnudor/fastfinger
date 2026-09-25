// FastFinger — Winner Declarer (Supabase Edge Function)
//
// Invoked by pg_cron on a schedule (every minute), not a database webhook —
// does the full job every time: settle standard matches, settle elimination
// round 1 (narrow to top 2 + 3rd), settle elimination round 2 (the final
// head-to-head), then declare anything settled but not yet on-chain, routed
// to the right contract by match.mode. Safe to call as often as you like.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ethers } from 'https://esm.sh/ethers@6.13.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ROUND_DURATION_SEC = 60
const SETTLE_BUFFER_SEC = 15
const ROUND_BREAK_SEC = 60

const ESCROW_ABI = ['function declareWinner(bytes32 matchId, address winner) external']
const ELIMINATION_ABI = ['function declareResults(bytes32 matchId, address first, address second, address third) external']

const uuidToBytes32 = (uuid: string) => '0x' + uuid.replace(/-/g, '').padEnd(64, '0')

type Player = { wallet_address: string; score: number; avg_reaction_time: number | null; round?: number }

const pickWinner = (players: Player[]): Player => {
  const sorted = [...players].sort((a, b) => b.score - a.score)
  const top = sorted[0]?.score ?? 0
  const tied = sorted.filter((p) => p.score === top)
  return tied.length === 1
    ? tied[0]
    : tied.sort((a, b) => (a.avg_reaction_time ?? 9999) - (b.avg_reaction_time ?? 9999))[0]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const RPC_URL = Deno.env.get('ROBINHOOD_RPC') || 'https://rpc.mainnet.chain.robinhood.com'
  const ESCROW_ADDRESS = Deno.env.get('ESCROW_CONTRACT_ADDRESS')!
  const ELIMINATION_ADDRESS = Deno.env.get('ELIMINATION_ESCROW_ADDRESS') // optional
  const ADMIN_PRIVATE_KEY = Deno.env.get('ADMIN_PRIVATE_KEY')!

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider)
  const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet)
  const elimination = ELIMINATION_ADDRESS ? new ethers.Contract(ELIMINATION_ADDRESS, ELIMINATION_ABI, adminWallet) : null

  let settled = 0
  let declared = 0
  let failed = 0
  const notes: string[] = []

  try {
    const cutoff = new Date(Date.now() - (ROUND_DURATION_SEC + SETTLE_BUFFER_SEC) * 1000).toISOString()

    // ── Settle standard matches ──────────────────────────────────────────────
    {
      const { data, error } = await supabase
        .from('matches')
        .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
        .eq('mode', 'standard')
        .eq('status', 'in_progress')
        .is('winner_wallet', null)
        .lte('game_start_time', cutoff)
      if (error) throw new Error(`settle standard: ${error.message}`)

      for (const match of data || []) {
        const id = String(match.id).slice(0, 8)
        const players = ((match.match_players as Player[]) || []).filter((p) => (p.round ?? 1) === 1)
        if (players.length === 0) { notes.push(`[${id}] no players, skipping`); continue }
        const winner = pickWinner(players)
        const { error: updErr } = await supabase.from('matches')
          .update({ winner_wallet: winner.wallet_address, status: 'finished', finished_at: new Date().toISOString() })
          .eq('id', match.id)
        if (updErr) { notes.push(`[${id}] write winner failed: ${updErr.message}`); failed++; continue }
        notes.push(`[${id}] standard settled: ${winner.wallet_address} (${winner.score} pts)`)
        settled++
      }
    }

    // ── Settle elimination Round 1 ───────────────────────────────────────────
    {
      const { data, error } = await supabase
        .from('matches')
        .select('id, match_players(wallet_address, score, avg_reaction_time, round)')
        .eq('mode', 'elimination')
        .eq('round', 1)
        .is('finalist_a', null)
        .lte('game_start_time', cutoff)
      if (error) throw new Error(`settle elim r1: ${error.message}`)

      for (const match of data || []) {
        const id = String(match.id).slice(0, 8)
        const players = ((match.match_players as Player[]) || []).filter((p) => (p.round ?? 1) === 1)
        if (players.length < 3) { notes.push(`[${id}] fewer than 3 r1 players, skipping`); continue }
        const sorted = [...players].sort((a, b) =>
          b.score !== a.score ? b.score - a.score : (a.avg_reaction_time ?? 9999) - (b.avg_reaction_time ?? 9999)
        )
        const [finalistA, finalistB, thirdPlace] = sorted
        const round2Start = new Date(Date.now() + ROUND_BREAK_SEC * 1000).toISOString()
        const { error: updErr } = await supabase.from('matches').update({
          finalist_a: finalistA.wallet_address,
          finalist_b: finalistB.wallet_address,
          elim_third: thirdPlace.wallet_address,
          round: 2,
          round2_start_time: round2Start,
        }).eq('id', match.id)
        if (updErr) { notes.push(`[${id}] write r1 results failed: ${updErr.message}`); failed++; continue }
        notes.push(`[${id}] r1 settled: advancing ${finalistA.wallet_address}, ${finalistB.wallet_address}; 3rd ${thirdPlace.wallet_address}`)
        settled++
      }
    }

    // ── Settle elimination Round 2 ───────────────────────────────────────────
    {
      const { data, error } = await supabase
        .from('matches')
        .select('id, finalist_a, finalist_b, match_players(wallet_address, score, avg_reaction_time, round)')
        .eq('mode', 'elimination')
        .eq('round', 2)
        .is('winner_wallet', null)
        .not('finalist_a', 'is', null)
        .lte('round2_start_time', cutoff)
      if (error) throw new Error(`settle elim r2: ${error.message}`)

      for (const match of data || []) {
        const id = String(match.id).slice(0, 8)
        const r2 = ((match.match_players as Player[]) || []).filter((p) => (p.round ?? 1) === 2)
        const scoreFor = (wallet: string): Player =>
          r2.find((p) => p.wallet_address === wallet) || { wallet_address: wallet, score: 0, avg_reaction_time: 9999 }
        const a = scoreFor(String(match.finalist_a))
        const b = scoreFor(String(match.finalist_b))
        const winner = pickWinner([a, b])
        const runnerUp = winner.wallet_address === a.wallet_address ? b : a
        const { error: updErr } = await supabase.from('matches').update({
          winner_wallet: winner.wallet_address,
          runner_up: runnerUp.wallet_address,
          status: 'finished',
          finished_at: new Date().toISOString(),
        }).eq('id', match.id)
        if (updErr) { notes.push(`[${id}] write r2 results failed: ${updErr.message}`); failed++; continue }
        notes.push(`[${id}] r2 settled: winner ${winner.wallet_address} (${winner.score} pts)`)
        settled++
      }
    }

    // ── Declare on-chain whatever is settled but not yet declared ────────────
    {
      const { data, error } = await supabase
        .from('matches')
        .select('id, mode, winner_wallet, runner_up, elim_third, match_players(wallet_address)')
        .eq('status', 'finished')
        .not('winner_wallet', 'is', null)
        .is('declare_tx', null)
      if (error) throw new Error(`declare query: ${error.message}`)

      for (const match of data || []) {
        const id = String(match.id).slice(0, 8)
        const players = ((match.match_players as { wallet_address: string }[]) || []).map((p) => p.wallet_address.toLowerCase())
        if (!players.includes(String(match.winner_wallet).toLowerCase())) {
          notes.push(`[${id}] winner not in player list — manual review`)
          continue
        }
        try {
          let tx
          if (match.mode === 'elimination') {
            if (!elimination) { notes.push(`[${id}] ELIMINATION_ESCROW_ADDRESS not set, skipping`); continue }
            if (!match.runner_up || !match.elim_third) { notes.push(`[${id}] missing runner_up/elim_third, skipping`); continue }
            tx = await elimination.declareResults(uuidToBytes32(String(match.id)), match.winner_wallet, match.runner_up, match.elim_third)
          } else {
            tx = await escrow.declareWinner(uuidToBytes32(String(match.id)), match.winner_wallet)
          }
          const receipt = await tx.wait()
          await supabase.from('matches').update({ declare_tx: tx.hash }).eq('id', match.id)
          notes.push(`[${id}] declared, tx ${tx.hash}, block ${receipt.blockNumber}`)
          declared++
        } catch (err) {
          const msg = (err as { reason?: string; message?: string }).reason || (err as Error).message || String(err)
          if (msg.includes('already') || msg.includes('0x7bfa4b9f')) {
            await supabase.from('matches').update({ declare_tx: 'already-declared' }).eq('id', match.id)
            notes.push(`[${id}] was already declared, synced`)
            declared++
          } else {
            notes.push(`[${id}] declare failed: ${msg}`)
            failed++
          }
        }
      }
    }

    return new Response(JSON.stringify({ settled, declared, failed, notes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[declare-winner] fatal:', (err as Error).message)
    return new Response(JSON.stringify({ error: (err as Error).message, settled, declared, failed, notes }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
