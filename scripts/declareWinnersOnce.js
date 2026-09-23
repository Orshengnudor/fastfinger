import 'dotenv/config';
import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';

const RPC_URL           = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const ESCROW_ADDRESS    = process.env.ESCROW_CONTRACT_ADDRESS;
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;

if (!ESCROW_ADDRESS)    { console.error('ESCROW_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }
if (!process.env.SUPABASE_URL) { console.error('SUPABASE_URL not set'); process.exit(1); }
if (!process.env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_SERVICE_KEY not set'); process.exit(1); }

const provider    = new ethers.JsonRpcProvider(RPC_URL);
const adminWallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ESCROW_ABI = [
  'function declareWinner(bytes32 matchId, address winner) external',
];
const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, adminWallet);

const uuidToBytes32 = (uuid) => '0x' + uuid.replace(/-/g, '').padEnd(64, '0');

const run = async () => {
  console.log('=== FastFinger Winner Declarer (one-shot) ===');
  console.log(`Admin:  ${adminWallet.address}`);
  console.log(`Escrow: ${ESCROW_ADDRESS}`);

  const balance = await provider.getBalance(adminWallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, winner_wallet, match_players(wallet_address)')
    .eq('status', 'finished')
    .not('winner_wallet', 'is', null)
    .is('declare_tx', null);

  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  if (!matches?.length) { console.log('No pending matches. Done.'); process.exit(0); }

  console.log(`Found ${matches.length} match(es).`);
  let processed = 0, failed = 0;

  for (const match of matches) {
    const id = match.id.slice(0, 8);
    try {
      const players = (match.match_players || []).map(p => p.wallet_address.toLowerCase());
      if (!players.includes(match.winner_wallet.toLowerCase())) {
        console.error(`[${id}] Winner not in player list`);
        await supabase.from('matches').update({ declare_tx: 'invalid-winner' }).eq('id', match.id);
        continue;
      }
      console.log(`[${id}] Declaring: ${match.winner_wallet}`);
      const tx = await escrowContract.declareWinner(uuidToBytes32(match.id), match.winner_wallet);
      console.log(`[${id}] TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`[${id}] Confirmed block ${receipt.blockNumber} ✅`);
      await supabase.from('matches').update({ declare_tx: tx.hash }).eq('id', match.id);
      processed++;
    } catch (err) {
      const msg = err.reason || err.message || String(err);
      console.error(`[${id}] Failed: ${msg}`);
      if (msg.includes('already') || msg.includes('0x7bfa4b9f')) {
        await supabase.from('matches').update({ declare_tx: 'already-declared' }).eq('id', match.id);
        processed++;
      } else { failed++; }
    }
  }

  console.log(`Done. Processed: ${processed}, Failed: ${failed}`);
  process.exit(processed === 0 && failed > 0 ? 1 : 0);
};

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
