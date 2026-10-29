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
} as const;

export type Messages = typeof en;
