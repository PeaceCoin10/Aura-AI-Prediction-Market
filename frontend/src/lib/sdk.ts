import { createPublicClient, fallback, http, parseAbi, type Hex } from "viem";
import { base } from "viem/chains";
import { CentralPredictionSDK, type Transport } from "@sdk";
import { CHAIN_ID, ENGINE_ADDRESS, RPC_URLS, USDC_ADDRESS } from "./config";

/** Read-only client: fallback across several RPCs, any one of them alive is enough */
export const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    RPC_URLS.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
    { rank: false },
  ),
  batch: { multicall: false },
});

/** On-chain time cached for 8s — every SDK build asks for now; do not let getBlock hammer the RPC */
let nowCache = { at: 0, value: 0n };
const chainNow = async (): Promise<bigint> => {
  if (Date.now() - nowCache.at < 8_000) return nowCache.value;
  const block = await publicClient.getBlock({ blockTag: "latest" });
  nowCache = { at: Date.now(), value: block.timestamp };
  return block.timestamp;
};

/** Minimal read transport the SDK needs (read-only, never sends transactions) */
const readTransport: Transport = {
  ethCall: async (to, data) =>
    (await publicClient.request({
      method: "eth_call",
      params: [{ to: to as `0x${string}`, data: data as `0x${string}` }, "latest"],
    })) as Hex,
  now: chainNow,
};

/** Build a fresh SDK instance per read path: it follows the active account, with no cross-account cache */
export function makeSdk(account?: string): CentralPredictionSDK {
  return new CentralPredictionSDK(readTransport, {
    engine: ENGINE_ADDRESS,
    chainId: CHAIN_ID,
    ...(account ? { account } : {}),
  });
}

/** Account-free read-only instance (used by list views) */
export const readSdk = makeSdk();

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** seedLiquidity is not in the SDK's encoder (creator-only path), so it is encoded with viem directly */
export const ENGINE_EXTRA_ABI = parseAbi([
  "function seedLiquidity(bytes32 marketId, uint256 amount)",
  "function canCreate(address account) view returns (bool)",
]);

export async function usdcBalance(account: string): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account as `0x${string}`],
  })) as bigint;
}

export async function usdcAllowance(account: string): Promise<bigint> {
  return (await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account as `0x${string}`, ENGINE_ADDRESS],
  })) as bigint;
}
