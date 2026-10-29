export type NavKey = "hot" | "crypto" | "news" | "sports" | "esports" | "tech";

export const NAV: Array<{ key: NavKey; label: string; icon: string; hint: string }> = [
  { key: "hot", label: "Trending", icon: "🔥", hint: "Every vertical, ranked by activity" },
  { key: "crypto", label: "Crypto", icon: "₿", hint: "Majors and DeFi flows" },
  { key: "news", label: "News", icon: "📰", hint: "World news, geopolitics, macro" },
  { key: "sports", label: "Sports", icon: "🏀", hint: "NBA, NFL, Premier League, UCL" },
  { key: "esports", label: "Esports", icon: "🎮", hint: "LoL, CS2, VCT" },
  { key: "tech", label: "Tech", icon: "🤖", hint: "AI, silicon, regulation" },
];

/** Map an on-chain or featured `category` onto a nav vertical. */
export function groupOf(category?: string): NavKey | "other" {
  const c = (category ?? "").toLowerCase().trim();
  if (!c) return "other";
  if (c.includes("crypto") || c.includes("defi") || c.includes("token")) return "crypto";
  if (c.includes("news") || c.includes("politic") || c.includes("macro") || c.includes("world")) return "news";
  // Order matters: "esport" also contains "sport", so esports must be tested first.
  if (c.includes("esport") || c.includes("game") || c.includes("lol") || c.includes("cs2") || c.includes("vct")) return "esports";
  if (c.includes("sport") || c.includes("nba") || c.includes("nfl") || c.includes("soccer")) return "sports";
  if (c.includes("tech") || c.includes("ai")) return "tech";
  return "other";
}

export const NAV_LABEL: Record<string, string> = {
  hot: "Trending",
  crypto: "Crypto",
  news: "News",
  sports: "Sports",
  esports: "Esports",
  tech: "Tech",
  other: "Other",
};
