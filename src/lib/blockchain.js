import { ethers } from 'ethers';

// ─── Network — Robinhood Chain mainnet only ────────────────────────────────
export const CHAIN = {
  id: 4663,
  name: 'Robinhood Chain',
  rpcUrl: import.meta.env.VITE_ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
};

// Real Rare Friends contracts — confirmed at https://rarefriends.com/docs/contracts
export const RF_TOKEN_ADDRESS = '0x0779369854d3EcdEA927206718FFD7730C67B71f';
export const GENERATIONS_ADDRESS = '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D';

export const ESCROW_CONTRACT_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT || null;

export const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl, undefined, { staticNetwork: true });

export const explorerTx = (hash) => `${CHAIN.explorerUrl}/tx/${hash}`;
export const explorerAddress = (addr) => `${CHAIN.explorerUrl}/address/${addr}`;

// ─── Tiers ────────────────────────────────────────────────────────────────────
// Must match FastFingerEscrow.tierEntry(uint8) exactly.
export const ENTRY_TIERS = [
  { index: 0, key: 'bronze',   label: 'Bronze',   rf: 10,   icon: '🥉' },
  { index: 1, key: 'silver',   label: 'Silver',   rf: 25,   icon: '🥈' },
  { index: 2, key: 'gold',     label: 'Gold',     rf: 50,   icon: '🥇' },
  { index: 3, key: 'platinum', label: 'Platinum', rf: 100,  icon: '💎' },
  { index: 4, key: 'diamond',  label: 'Diamond',  rf: 250,  icon: '💠' },
  { index: 5, key: 'elite',    label: 'Elite',    rf: 1000, icon: '👑' },
];

export const PLAYER_OPTIONS = [2, 3, 4, 5, 6, 8, 10];

export const getTierByIndex = (index) =>
  ENTRY_TIERS[Number(index)] || ENTRY_TIERS[0];

// Legacy string keys (bronze/silver/...) still map correctly for any old data.
export const getTierByKey = (key) =>
  ENTRY_TIERS.find(t => t.key === key) || ENTRY_TIERS[Number(key)] || ENTRY_TIERS[0];

// ─── Split preview — mirrors FastFingerEscrow.split() exactly (9000/9200 bps) ──
export const WINNER_BPS = 9000;
export const FRIEND_WINNER_BPS = 9200;

export const previewSplit = (potRf, hasFriend) => {
  const bps = hasFriend ? FRIEND_WINNER_BPS : WINNER_BPS;
  const payout = (potRf * bps) / 10_000;
  const rake = potRf - payout;
  const reward = rake / 2;
  const burn = rake - reward;
  return { payout, burn, reward };
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

const GENERATIONS_ABI = [
  'function ownerOf(uint256) view returns (address)',
  'function generation(uint256) view returns (uint8)',
];

const ESCROW_ABI = [
  'function createMatch(bytes32 matchId, uint8 tier, uint8 maxPlayers) external',
  'function joinMatch(bytes32 matchId) external',
  'function cancelMatch(bytes32 matchId) external',
  'function claimPrize(bytes32 matchId, uint256 friendId) external',
  'function getMatch(bytes32 matchId) external view returns (tuple(address host, uint8 tier, uint8 maxPlayers, uint8 playerCount, uint8 status, uint40 createdAt, uint40 lockedAt, uint40 declaredAt, address winner, uint256 entry))',
  'function getPlayers(bytes32 matchId) external view returns (address[])',
  'function isEligibleFriend(address account, uint256 friendId) external view returns (bool)',
  'function tierEntry(uint8 tier) external view returns (uint256)',
];

export const MATCH_STATUS = [
  'None', 'Open', 'Locked', 'Declared', 'Paid', 'Cancelled', 'Refunded', 'Swept',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const uuidToBytes32 = (uuid) => {
  const hex = uuid.replace(/-/g, '');
  return '0x' + hex.padEnd(64, '0');
};

export const walletClientToSigner = async (walletClient) => {
  const { account, chain, transport } = walletClient;
  const ethersProvider = new ethers.BrowserProvider(transport, { chainId: chain.id, name: chain.name });
  return ethersProvider.getSigner(account.address);
};

const rfToken = (signerOrProvider) => new ethers.Contract(RF_TOKEN_ADDRESS, ERC20_ABI, signerOrProvider);
const generations = (signerOrProvider) => new ethers.Contract(GENERATIONS_ADDRESS, GENERATIONS_ABI, signerOrProvider);
const escrow = (signerOrProvider) => {
  if (!ESCROW_CONTRACT_ADDRESS) throw new Error('VITE_ESCROW_CONTRACT not set');
  return new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, signerOrProvider);
};

let rfDecimalsCache = null;
const rfDecimals = async () => {
  if (rfDecimalsCache !== null) return rfDecimalsCache;
  try { rfDecimalsCache = await rfToken(provider).decimals(); }
  catch { rfDecimalsCache = 18; }
  return rfDecimalsCache;
};

export const toRfUnits = async (amountRf) => {
  const d = await rfDecimals();
  return ethers.parseUnits(String(amountRf), d);
};

export const fromRfUnits = async (amountWei) => {
  const d = await rfDecimals();
  return parseFloat(ethers.formatUnits(amountWei, d));
};

// ─── Balances ─────────────────────────────────────────────────────────────────
// RF is the stake. ETH is gas only — never spent on entries.
export const getRfBalance = async (address) => {
  if (!address || !RF_TOKEN_ADDRESS) return 0;
  try { return await fromRfUnits(await rfToken(provider).balanceOf(address)); }
  catch { return 0; }
};

export const getEthBalance = async (address) => {
  if (!address) return 0;
  try { return parseFloat(ethers.formatEther(await provider.getBalance(address))); }
  catch { return 0; }
};

export const validateEntryBalance = async (address, tierIndex) => {
  const tier = getTierByIndex(tierIndex);
  const balance = await getRfBalance(address);
  return {
    hasEnough: balance >= tier.rf,
    balance: parseFloat(balance.toFixed(4)),
    required: tier.rf,
    tierLabel: tier.label,
  };
};

// ─── Approval ─────────────────────────────────────────────────────────────────
// RF requires an ERC-20 approval before the escrow can pull a stake, unlike the
// old native-ETH `payable` flow. We approve exactly what's needed each time —
// simple and safe, at the cost of one extra signature per new stake amount.
const ensureApproval = async (signer, ownerAddress, amountWei) => {
  const token = rfToken(signer);
  const current = await token.allowance(ownerAddress, ESCROW_CONTRACT_ADDRESS);
  if (current >= amountWei) return null;
  const tx = await token.approve(ESCROW_CONTRACT_ADDRESS, amountWei);
  await tx.wait();
  return tx.hash;
};

// ─── On-chain calls ───────────────────────────────────────────────────────────
export const createMatchOnChain = async (walletClient, matchId, maxPlayers, tierIndex, onStatus) => {
  try {
    const tier = getTierByIndex(tierIndex);
    const entryWei = await toRfUnits(tier.rf);
    const matchIdBytes32 = uuidToBytes32(matchId);
    const signer = await walletClientToSigner(walletClient);
    const address = await signer.getAddress();

    onStatus?.('Checking RF approval...');
    await ensureApproval(signer, address, entryWei);

    onStatus?.('Staking RF...');
    const tx = await escrow(signer).createMatch(matchIdBytes32, tier.index, maxPlayers);
    const receipt = await tx.wait();
    return { success: true, txId: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    console.error('createMatchOnChain failed:', err);
    return { success: false, error: err.reason || err.shortMessage || err.message };
  }
};

export const joinMatchOnChain = async (walletClient, matchId, tierIndex, onStatus) => {
  try {
    const tier = getTierByIndex(tierIndex);
    const entryWei = await toRfUnits(tier.rf);
    const matchIdBytes32 = uuidToBytes32(matchId);
    const signer = await walletClientToSigner(walletClient);
    const address = await signer.getAddress();

    onStatus?.('Checking RF approval...');
    await ensureApproval(signer, address, entryWei);

    onStatus?.('Staking RF...');
    const tx = await escrow(signer).joinMatch(matchIdBytes32);
    const receipt = await tx.wait();
    return { success: true, txId: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    console.error('joinMatchOnChain failed:', err);
    return { success: false, error: err.reason || err.shortMessage || err.message };
  }
};

export const cancelMatchOnChain = async (walletClient, matchId) => {
  try {
    const matchIdBytes32 = uuidToBytes32(matchId);
    const signer = await walletClientToSigner(walletClient);
    const tx = await escrow(signer).cancelMatch(matchIdBytes32);
    const receipt = await tx.wait();
    return { success: true, txId: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    console.error('cancelMatchOnChain failed:', err);
    return { success: false, error: err.reason || err.shortMessage || err.message };
  }
};

export const claimPrizeOnChain = async (walletClient, matchId, friendId = 0n) => {
  try {
    if (!matchId) throw new Error('matchId required');
    const matchIdBytes32 = uuidToBytes32(matchId);
    const signer = await walletClientToSigner(walletClient);
    const contract = escrow(signer);

    try {
      await contract.claimPrize.estimateGas(matchIdBytes32, friendId);
    } catch (gasErr) {
      const reason = gasErr.reason || gasErr.shortMessage || '';
      if (/NotWinner/i.test(reason)) throw new Error('You are not the winner of this match.');
      if (/NotDeclared/i.test(reason)) throw new Error('Winner not declared yet — try again shortly.');
      if (/ClaimWindowClosed/i.test(reason)) throw new Error('The 7-day claim window has closed.');
      if (/NotYourFriend/i.test(reason)) throw new Error('That Friend is not a hardwired Generations NFT you own.');
      throw new Error(reason || 'Contract rejected the claim.');
    }

    const tx = await contract.claimPrize(matchIdBytes32, friendId);
    const receipt = await tx.wait();
    return { success: true, txId: tx.hash, blockNumber: receipt.blockNumber };
  } catch (err) {
    console.error('claimPrizeOnChain failed:', err);
    return { success: false, error: err.message };
  }
};

// ─── Reads ────────────────────────────────────────────────────────────────────
export const getMatchOnChain = async (matchId) => {
  try {
    const m = await escrow(provider).getMatch(uuidToBytes32(matchId));
    return {
      host: m.host,
      tier: Number(m.tier),
      maxPlayers: Number(m.maxPlayers),
      playerCount: Number(m.playerCount),
      status: MATCH_STATUS[Number(m.status)],
      winner: m.winner,
      entry: await fromRfUnits(m.entry),
    };
  } catch (err) {
    console.error('getMatchOnChain failed:', err);
    return null;
  }
};

// Checks a Friend the contract will actually accept for the 92% bonus: owned by
// `account` and hardwired (generation 1-6). Returns false on any bad/unknown ID
// rather than throwing, so the UI can just show "not eligible".
export const checkFriendEligible = async (account, friendId) => {
  if (!account || !friendId) return false;
  try { return await escrow(provider).isEligibleFriend(account, friendId); }
  catch { return false; }
};

export const getFriendGeneration = async (friendId) => {
  if (!friendId) return null;
  try { return Number(await generations(provider).generation(friendId)); }
  catch { return null; }
};

// ─── Format helpers ───────────────────────────────────────────────────────────
export const formatWallet = (address) => {
  if (!address) return '';
  const s = String(address);
  return s.length <= 12 ? s : `${s.slice(0, 6)}....${s.slice(-4)}`;
};

export const formatRf = (amount, decimals = 2) => parseFloat(amount || 0).toFixed(decimals);
export const formatEth = (eth) => parseFloat(eth || 0).toFixed(5);
