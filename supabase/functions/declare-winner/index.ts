import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ethers } from 'https://esm.sh/ethers@6.13.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body = await req.json()
    const record = body.record || body.new || body

    // Only process finished matches that haven't been declared yet
    if (!record || record.status !== 'finished' || !record.winner_wallet || record.declare_tx) {
      return new Response('OK', { headers: corsHeaders })
    }

    const RPC_URL = Deno.env.get('ROBINHOOD_RPC') || 'https://rpc.mainnet.chain.robinhood.com'
    const ESCROW_ADDRESS = Deno.env.get('ESCROW_CONTRACT_ADDRESS')
    const ADMIN_PRIVATE_KEY = Deno.env.get('ADMIN_PRIVATE_KEY')

    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider)

    const ESCROW_ABI = ['function declareWinner(bytes32 matchId, address winner) external']

    const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet)

    const uuidToBytes32 = (uuid) => '0x' + uuid.replace(/-/g, '').padEnd(64, '0')

    const matchIdBytes32 = uuidToBytes32(record.id)

    console.log(`[Auto] Declaring winner for match ${record.id.slice(0,8)}... Winner: ${record.winner_wallet}`)

    const tx = await contract.declareWinner(matchIdBytes32, record.winner_wallet)
    const receipt = await tx.wait()

    // Mark as declared in Supabase
    await supabase
      .from('matches')
      .update({ declare_tx: tx.hash })
      .eq('id', record.id)

    console.log(`[Auto] ✅ Winner declared successfully. TX: ${tx.hash}`)

    return new Response('Success', { headers: corsHeaders })
  } catch (err) {
    console.error('[Auto] Error in declare-winner:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: corsHeaders 
    })
  }
})