import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { encodeFunctionData, type Hex } from "viem";
import { CHAIN_ID, CHAIN_ID_HEX, ENGINE_ADDRESS, USDC_ADDRESS } from "./config";
import { ERC20_ABI, usdcAllowance } from "./sdk";
import { errText } from "./format";
import { gaslessReady, loginWithSocial, type SocialKind } from "./socialLogin";
import { en } from "../locales/en";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
}

export interface ProviderEntry {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

interface WalletState {
  providers: ProviderEntry[];
  account?: `0x${string}`;
  chainId?: number;
  activeName?: string;
  connecting: boolean;
  error?: string;
  connect: (entry?: ProviderEntry) => Promise<void>;
  /** Google / email smart account through Web3Auth; falls back to an explanatory error when unset */
  connectSocial: (kind: SocialKind) => Promise<void>;
  /** true when the active session trades through a sponsored smart account */
  sponsored: boolean;
  disconnect: () => void;
  switchToBase: () => Promise<void>;
  sendTransaction: (tx: { to: `0x${string}`; data: string }) => Promise<Hex>;
  approveUsdc: (amount: bigint) => Promise<Hex | null>;
  ensureUsdcAllowance: (amount: bigint) => Promise<void>;
}

const WalletCtx = createContext<WalletState | null>(null);

const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

/** EIP-6963 multi-wallet discovery, with window.ethereum as the fallback (MetaMask / Coinbase / any injected) */
function useDiscoverProviders(): ProviderEntry[] {
  const [list, setList] = useState<ProviderEntry[]>([]);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderEntry>).detail;
      if (!detail?.info?.uuid) return;
      setList((prev) =>
        prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Fallback for older wallets that never announce via 6963
    const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (injected) {
      const fallbackEntry: ProviderEntry = {
        info: {
          uuid: "injected-fallback",
          name: injected.isCoinbaseWallet ? "Coinbase Wallet" : injected.isMetaMask ? "MetaMask" : en.content.wallet.fallbackName,
          icon: "",
          rdns: "injected",
        },
        provider: injected,
      };
      setList((prev) => (prev.length ? prev : [fallbackEntry]));
    }
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  return list;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const providers = useDiscoverProviders();
  const [entry, setEntry] = useState<ProviderEntry | null>(null);
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const switchToBase = useCallback(async () => {
    if (!entry) return;
    try {
      await entry.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4902 || errText(e).toLowerCase().includes("unrecognized")) {
        await entry.provider.request({
          method: "wallet_addEthereumChain",
          params: [CHAIN_PARAMS],
        });
      } else {
        throw e;
      }
    }
    const cid = (await entry.provider.request({ method: "eth_chainId" })) as string;
    setChainId(Number(cid));
  }, [entry]);

  const connect = useCallback(
    async (chosen?: ProviderEntry) => {
      const target = chosen ?? providers[0];
      if (!target) {
        setError(en.content.wallet.noProvider);
        return;
      }
      setConnecting(true);
      setError(undefined);
      try {
        const accounts = (await target.provider.request({
          method: "eth_requestAccounts",
        })) as string[];
        if (!accounts?.length) throw new Error(en.content.wallet.noAccounts);
        setEntry(target);
        setAccount(accounts[0] as `0x${string}`);
        const cid = (await target.provider.request({ method: "eth_chainId" })) as string;
        setChainId(Number(cid));
        if (Number(cid) !== CHAIN_ID) {
          try {
            await target.provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: CHAIN_ID_HEX }],
            });
            setChainId(CHAIN_ID);
          } catch {
            /* User declined the chain switch: keep the current chain, the UI surfaces it */
          }
        }
      } catch (e) {
        setError(errText(e));
      } finally {
        setConnecting(false);
      }
    },
    [providers],
  );

  const disconnect = useCallback(() => {
    setEntry(null);
    setAccount(undefined);
    setChainId(undefined);
  }, []);

  /**
   * Social login: Web3Auth hands back an EIP-1193 provider owned by the user's Google / email key.
   * It is registered as a normal provider entry, so every existing code path (approve, trade,
   * decode) works unchanged — the only difference is that gas can be sponsored when a bundler is
   * configured (`sendTransaction` routes through ERC-4337 in that case).
   */
  const connectSocial = useCallback(async (kind: SocialKind) => {
    setConnecting(true);
    setError(undefined);
    try {
      const res = await loginWithSocial(kind);
      if (!res.address || !res.provider) {
        setError(res.error ?? en.content.wallet.noAccounts);
        return;
      }
      const socialEntry: ProviderEntry = {
        info: {
          uuid: `web3auth-${kind}`,
          name: kind === "google" ? "Google (smart account)" : "Email (smart account)",
          icon: "",
          rdns: "io.web3auth",
        },
        provider: res.provider as Eip1193Provider,
      };
      setEntry(socialEntry);
      setAccount(res.address as `0x${string}`);
      setChainId(CHAIN_ID);
    } catch (e) {
      setError(errText(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  // Account / chain changes
  useEffect(() => {
    const p = entry?.provider;
    if (!p?.on) return;
    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[];
      setAccount(accounts?.length ? (accounts[0] as `0x${string}`) : undefined);
      if (!accounts?.length) setEntry(null);
    };
    const onChain = (...args: never[]) => {
      const cid = args[0] as unknown as string;
      setChainId(Number(cid));
    };
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [entry]);

  const sponsored = Boolean(entry && entry.info.rdns === "io.web3auth" && gaslessReady());

  const sendTransaction = useCallback(
    async (tx: { to: `0x${string}`; data: string }) => {
      if (!entry || !account) throw new Error(en.content.wallet.notConnected);

      // A social session is a Web3Auth smart account: when the project has a bundler + paymaster,
      // the provider itself wraps the call in a sponsored user operation, so the same
      // eth_sendTransaction below needs no Base ETH. Without one it behaves as a plain EOA.
      if (chainId !== CHAIN_ID) {
        await switchToBase();
      }
      const hash = (await entry.provider.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: tx.to, data: tx.data, value: "0x0" }],
      })) as Hex;
      return hash;
    },
    [entry, account, chainId, switchToBase],
  );

  const approveUsdc = useCallback(
    async (amount: bigint) => {
      if (!entry || !account) throw new Error(en.content.wallet.notConnected);
      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ENGINE_ADDRESS, amount],
      });
      return sendTransaction({ to: USDC_ADDRESS, data });
    },
    [entry, account, sendTransaction],
  );

  const ensureUsdcAllowance = useCallback(
    async (amount: bigint) => {
      if (!entry || !account) throw new Error(en.content.wallet.notConnected);
      const current = await usdcAllowance(account);
      if (current >= amount) return;
      // Approve 2x the amount so every trade does not trigger a fresh approve prompt; still a bounded allowance
      await approveUsdc(amount * 2n);
    },
    [entry, account, approveUsdc],
  );

  const value = useMemo<WalletState>(
    () => ({
      providers,
      account,
      chainId,
      activeName: entry?.info.name,
      connecting,
      error,
      connect,
      connectSocial,
      sponsored,
      disconnect,
      switchToBase,
      sendTransaction,
      approveUsdc,
      ensureUsdcAllowance,
    }),
    [
      providers,
      account,
      chainId,
      entry,
      connecting,
      error,
      connect,
      connectSocial,
      sponsored,
      disconnect,
      switchToBase,
      sendTransaction,
      approveUsdc,
      ensureUsdcAllowance,
    ],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error(en.content.wallet.hookOutsideProvider);
  return ctx;
}
