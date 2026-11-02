/**
 * Session identity for share/attribution surfaces.
 *
 * The connected account is set once by the app shell and read by leaf components (poster, invite
 * link, points strip) without threading props through the card tree. It is a display/attribution
 * hint only — every write still requires a wallet signature.
 */
const KEY = "aura.identity.v1";

let current: string | null = null;

export function setIdentity(address?: string | null): void {
  current = address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
  try {
    if (current) localStorage.setItem(KEY, current);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function getIdentity(): string | null {
  if (current) return current;
  try {
    const raw = localStorage.getItem(KEY);
    return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Short form used in posters and chips: 0x1234…abcd */
export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
