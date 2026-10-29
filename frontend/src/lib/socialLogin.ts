/**
 * Zero-friction entry: social / email login through Web3Auth, plus a paymaster
 * hook for gasless first trades.
 *
 * Both integrations are optional and lazily imported, so the production bundle
 * builds and runs with no third-party credentials. Drop in
 * `VITE_WEB3AUTH_CLIENT_ID` (Web3Auth dashboard) and `VITE_PAYMASTER_URL`
 * (Pimlico / Biconomy / Alchemy bundler) and the same UI turns into a real
 * smart-account flow with sponsored user operations.
 */

const CLIENT_ID = import.meta.env.VITE_WEB3AUTH_CLIENT_ID as string | undefined;
const PAYMASTER = import.meta.env.VITE_PAYMASTER_URL as string | undefined;

export type SocialKind = "google" | "email";

/** Minimal EIP-1193 surface; kept structural so this module never imports the wallet context. */
export interface SocialProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
}

export interface SocialResult {
  address?: string;
  /** EIP-1193 provider owned by the social key: usable for signing and, with a bundler, for user operations */
  provider?: SocialProvider;
  error?: string;
  /** true when the SDK is not configured, so the UI can explain instead of failing */
  unconfigured?: boolean;
}

export function socialConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

export function paymasterConfigured(): boolean {
  return Boolean(PAYMASTER);
}

/**
 * Opens the Web3Auth modal and returns the smart-account address.
 * The package is an optional peer dependency: importing it lazily keeps
 * `npm ls` clean for people who only want injected wallets.
 */
export async function loginWithSocial(kind: SocialKind): Promise<SocialResult> {
  if (!CLIENT_ID) {
    return {
      unconfigured: true,
      error:
        "Social login is not configured in this build. Set VITE_WEB3AUTH_CLIENT_ID to enable Google / email smart accounts.",
    };
  }
  try {
    const pkg = "@web3auth/modal";
    const { Web3Auth } = (await import(/* @vite-ignore */ pkg)) as {
      Web3Auth: new (opts: Record<string, unknown>) => {
        init: () => Promise<void>;
        connect: () => Promise<{ accounts?: { address?: string }[] }>;
        provider?: SocialProvider | null;
      };
    };
    const web3auth = new Web3Auth({
      clientId: CLIENT_ID,
      web3AuthNetwork: "sapphire_mainnet",
      chainConfig: {
        chainNamespace: "eip155",
        chainId: "0x2105",
        rpcTarget: "https://mainnet.base.org",
        ...aaChainConfig(),
      },
    });
    await web3auth.init();
    const info = await web3auth.connect();
    const address = info?.accounts?.[0]?.address;
    const provider = web3auth.provider ?? undefined;
    if (!address) return { error: `No account returned by the ${kind} flow.` };
    return { address, provider };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Social login failed." };
  }
}

/** Paymaster endpoint for ERC-4337 user operations, or null when unset. */
export function paymasterUrl(): string | null {
  return PAYMASTER ?? null;
}

/**
 * ERC-4337 wiring handed to Web3Auth, which then builds the Coinbase Smart Account and wraps every
 * `eth_sendTransaction` in a user operation sponsored by the paymaster. Keeping the bundler and the
 * paymaster in the same config means the provider we register in the wallet context is already a
 * gasless smart account — no second signing path, no duplicated nonce handling.
 */
export function aaChainConfig(): Record<string, unknown> {
  const bundler = (import.meta.env.VITE_BUNDLER_URL as string | undefined) ?? PAYMASTER;
  if (!bundler) return {};
  return {
    bundlerConfig: { url: bundler },
    ...(PAYMASTER ? { paymasterConfig: { url: PAYMASTER } } : {}),
  };
}

/** True when the first trades of a smart account can be sponsored. */
export function gaslessReady(): boolean {
  return Boolean(PAYMASTER && CLIENT_ID);
}
