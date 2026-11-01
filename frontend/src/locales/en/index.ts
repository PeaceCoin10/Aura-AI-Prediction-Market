import { shell } from "./shell";
import { hall } from "./hall";
import { content } from "./content";
import { security } from "./security";
import { trade } from "./trade";
import { paper } from "./paper";
import { portfolio } from "./portfolio";
import { marketing } from "./marketing";
import { social } from "./social";
import { airdrop } from "./airdrop";
import { ui } from "./ui";
import { terminal } from "./terminal";
import { affiliate } from "./affiliate";
import { live } from "./live";

/**
 * English message tree — the reference implementation every other locale must satisfy.
 * Namespaces map 1:1 to product surfaces so a translator can work on one file at a time.
 */
export const en = {
  shell,
  hall,
  content,
  security,
  trade,
  paper,
  portfolio,
  marketing,
  social,
  airdrop,
  ui,
  terminal,
  affiliate,
  live,
} as const;

/**
 * Structural message type.
 *
 * `en` itself is `as const` so component code gets literal types, but a translation must be allowed
 * to use *different* text. `Widen` (deeply) replaces every literal with `string` while preserving
 * the key structure, so a locale that forgets a namespace, a key or a nested field fails to compile
 * instead of rendering `undefined` at runtime.
 */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? readonly Widen<U>[]
        : T extends object
          ? { [K in keyof T]: Widen<T[K]> }
          : T;

export type Messages = Widen<typeof en>;
