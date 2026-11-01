/**
 * Live-market strip copy.
 *
 * These markets are generated from real spot prices at render time; the copy must therefore say where
 * the price came from and when it was read, without ever implying that the venue has real liquidity.
 */
export const live = {
  badge: "LIVE",
  title: "Live markets",
  subtitle: "Real spot prices, thresholds derived from the current price and a fixed UTC close",
  source: "CoinGecko spot",
  updated: "Updated {{time}}",
  question: "Will {{asset}} close above {{price}} by {{date}}?",
  criteria: "CoinGecko {{asset}}/USD daily close at 00:00 UTC on {{date}}.",
  spot: "Spot {{price}}",
  distance: "{{pct}}% to strike",
  trade: "Trade",
  unavailable: "Live prices unavailable — the catalogue below is unaffected.",
};
