import { WagmiProvider, createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import { CHAIN } from '../lib/blockchain';

// Robinhood Chain isn't in every viem/wagmi release's built-in chain list yet,
// so it's defined explicitly here rather than imported from 'viem/chains'.
const robinhoodMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

const config = createConfig(
  getDefaultConfig({
    chains: [robinhoodMainnet],
    transports: { [robinhoodMainnet.id]: http(CHAIN.rpcUrl) },
    walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '1ac6d1d1473a81fef1a18f15ccf1dc52',
    appName: 'FastFinger',
    appDescription: 'Skill. Stake. Burn. A real-time multiplayer reaction game staking $RAREFRIENDS on Robinhood Chain.',
    appUrl: 'https://fastfinger.xyz',
    appIcon: 'https://fastfinger.xyz/icon-512.png',
  })
);

const queryClient = new QueryClient();

export default function WalletProvider({ children }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          theme="midnight"
          customTheme={{
            '--ck-accent-color': '#ccff00',
            '--ck-accent-text-color': '#0d0d0f',
            '--ck-body-background': '#16161a',
            '--ck-body-color': '#f5f5f0',
            '--ck-border-radius': '14px',
          }}
          options={{
            hideBalance: false,
            hideTooltips: false,
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
