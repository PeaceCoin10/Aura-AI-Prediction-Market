/**
 * Featured market catalogue — the hall's mock book.
 *
 * These are *samples*: no money, no settlement, no chain. They exist so the product has a full
 * book on first paint, and they are quoted with the SDK's real CPMM maths so the prices a visitor
 * sees are structurally identical to the live engine's.
 *
 * Market questions and criteria are data (the same way an on-chain market's `question` is data);
 * UI chrome lives in `src/locales/en/`.
 *
 * Artwork: every id maps to a generated SVG at `${BASE_URL}art/<id>.svg`,
 * produced by `frontend/scripts/gen_market_art.py`.
 */
import type { DemoMarket, Vertical } from "../lib/demo";

const USDC = 1_000_000n;
const HOUR = 3600;
/** Fixed "now" anchor so render time cannot drift between modules */
const BOOT = Math.floor(Date.now() / 1000);

/** Invert "target YES probability + pool depth" into reserves that the real CPMM quote understands. */
function pool(targetProb: number, depthUsdc: number): { yesReserve: bigint; noReserve: bigint } {
  const depth = BigInt(Math.round(depthUsdc * Number(USDC)));
  const no = BigInt(Math.round(Number(depth) * targetProb));
  return { yesReserve: depth - no, noReserve: no };
}

type Row = [string, Vertical, string, string, string, number, number, number, number, string];

/** id, vertical, question, criteria, source, prob, depth, hours, volume, topic */
const ROWS: Row[] = [
  ["btc-90k", "crypto", "Will BTC close above $90,000 this week?", "CoinGecko daily close on the last day of the week, 00:00 UTC.", "CoinGecko", 0.42, 52000, 72, 182400, "BTC Price"],
  ["btc-100k", "crypto", "Will BTC print a new all-time high above $105,000 this month?", "Any Binance BTC/USDT trade above 105,000 within the month.", "Binance", 0.28, 61000, 168, 241800, "BTC ATH"],
  ["btc-dominance", "crypto", "Will BTC dominance stay above 55% through Friday?", "CoinGecko global market cap share at Friday 00:00 UTC.", "CoinGecko", 0.61, 18000, 96, 64200, "Dominance"],
  ["eth-5k", "crypto", "Will ETH close above $5,000 this month?", "CoinGecko daily close on the final day of the month.", "CoinGecko", 0.34, 44000, 168, 158300, "ETH Price"],
  ["eth-etf-flow", "crypto", "Will US spot ETH ETFs post net inflows above $500M this week?", "Farside Investors weekly net flow table.", "Farside Investors", 0.47, 31500, 120, 74900, "ETF Flows"],
  ["btc-etf-outflow", "crypto", "Will US spot BTC ETFs see a net outflow day this week?", "Any single day with negative total net flow, Farside data.", "Farside Investors", 0.55, 27000, 120, 88700, "ETF Flows"],
  ["sol-300", "crypto", "Will SOL close above $300 this month?", "CoinGecko daily close on the final day of the month.", "CoinGecko", 0.38, 21000, 168, 94300, "SOL"],
  ["sol-etf", "crypto", "Will the SEC approve a spot SOL ETF before quarter end?", "Official SEC order or approval notice.", "SEC.gov", 0.31, 24000, 300, 112600, "ETF Approval"],
  ["xrp-etf", "crypto", "Will a spot XRP ETF start trading this quarter?", "First day of trading on a US exchange.", "SEC.gov", 0.29, 16000, 300, 58700, "ETF Approval"],
  ["stablecoin-bill", "crypto", "Will a US stablecoin bill be signed into law this session?", "Presidential signature reported by Congress.gov.", "Congress.gov", 0.44, 33000, 240, 121400, "Regulation"],
  ["clarity-act", "crypto", "Will the market-structure bill pass the Senate this quarter?", "Final Senate vote recorded on Senate.gov.", "Senate.gov", 0.39, 28500, 280, 98600, "Regulation"],
  ["cpi-3", "crypto", "Will US CPI year-over-year print below 3.0% next release?", "BLS CPI release, headline YoY figure.", "BLS", 0.52, 41000, 96, 167200, "Macro CPI"],
  ["fed-cut", "crypto", "Will the Fed cut rates at the next FOMC meeting?", "FOMC statement target range lower than the prior meeting.", "Federal Reserve", 0.63, 48000, 150, 214900, "Fed Rates"],
  ["fed-50", "crypto", "Will the next cut be 50bp or larger?", "FOMC statement target range change ≥ 50bp.", "Federal Reserve", 0.18, 19000, 150, 67300, "Fed Rates"],
  ["treasury-5", "crypto", "Will the 10-year Treasury yield close above 4.5% this week?", "US Treasury daily yield curve, Friday close.", "US Treasury", 0.36, 15000, 120, 49800, "Rates"],
  ["base-tvl", "crypto", "Will Base TVL hold above $6B through the week?", "DefiLlama chain TVL at week end.", "DefiLlama", 0.58, 12800, 120, 41200, "Base TVL"],
  ["l2-fees", "crypto", "Will average Base gas fall below $0.005 per swap this week?", "Median swap fee from L2Fees weekly snapshot.", "L2Fees", 0.66, 9400, 120, 28600, "Base Fees"],
  ["dex-volume", "crypto", "Will DEX volume across majors exceed $40B in a single day?", "DefiLlama DEX volume aggregator, any day this week.", "DefiLlama", 0.41, 17500, 120, 71800, "DEX Volume"],
  ["perp-funding", "crypto", "Will BTC perp funding stay positive for 7 straight days?", "Binance BTCUSDT perpetual funding rate, every 8h settlement.", "Binance", 0.57, 11200, 168, 33900, "Derivatives"],
  ["hack-100m", "crypto", "Will any DeFi protocol lose more than $100M to an exploit this month?", "Public post-mortem or on-chain loss confirmed by Rekt.", "Rekt", 0.22, 14500, 240, 52700, "Security"],
  ["unlock-arb", "crypto", "Will ARB trade lower 24h after its next token unlock?", "CoinGecko close 24h after the unlock timestamp.", "CoinGecko", 0.54, 8600, 96, 21400, "Unlocks"],
  ["memecoin-cap", "crypto", "Will total memecoin market cap print above $120B this month?", "CoinGecko category market cap.", "CoinGecko", 0.33, 10200, 240, 37600, "Memecoins"],
  ["btc-vol", "crypto", "Will BTC 30-day implied volatility close above 60?", "Deribit DVOL index at week end.", "Deribit", 0.45, 9800, 120, 29800, "Volatility"],
  ["eth-burn", "crypto", "Will ETH supply keep shrinking this week?", "Ultrasound.money net issuance, 7-day average.", "Ultrasound", 0.62, 12400, 120, 36400, "ETH Supply"],
  ["rwa-tvl", "crypto", "Will tokenised RWA TVL cross $20B this quarter?", "RWA.xyz total on-chain value.", "RWA.xyz", 0.48, 13900, 280, 45200, "RWA"],
  ["quantum-btc", "crypto", "Will a major wallet provider announce post-quantum keys this quarter?", "Official announcement from a top-5 wallet vendor.", "Company blogs", 0.26, 7800, 300, 18600, "Security"],
  ["midterms-house", "news", "Will Republicans hold the House in the midterms?", "Certified seat count from the AP race calls.", "AP", 0.51, 72000, 220, 268400, "US Midterms"],
  ["midterms-senate", "news", "Will Democrats win the Senate majority?", "Certified seat count from the AP race calls.", "AP", 0.44, 66000, 220, 241700, "US Midterms"],
  ["gov-shutdown", "news", "Will the US federal government shut down this quarter?", "OMB guidance or a lapse in appropriations reported by Congress.gov.", "Congress.gov", 0.37, 38000, 280, 142600, "US Budget"],
  ["supreme-court", "news", "Will the Supreme Court rule on the tariff case this term?", "Opinion published on supremecourt.gov.", "Supreme Court", 0.58, 24000, 300, 86400, "SCOTUS"],
  ["tariff-25", "news", "Will the US raise tariffs on Chinese EVs above 25%?", "USTR Federal Register notice.", "USTR", 0.49, 29000, 260, 99700, "Trade"],
  ["china-stimulus", "news", "Will China announce a stimulus package above ¥1tn this quarter?", "State Council or PBOC official announcement.", "State Council", 0.41, 27000, 280, 91300, "China Macro"],
  ["opec-cut", "news", "Will OPEC+ extend production cuts at the next meeting?", "Official OPEC communiqué.", "OPEC", 0.56, 19000, 240, 68400, "Oil"],
  ["ukraine-ceasefire", "news", "Will a formal ceasefire deal be signed this quarter?", "Signed agreement confirmed by two major wire services.", "Reuters", 0.24, 34000, 280, 131200, "Geopolitics"],
  ["gaza-deal", "news", "Will a hostage-release deal be confirmed by two major outlets?", "Reuters/AP/BBC confirmation.", "Reuters", 0.31, 31000, 280, 118500, "Geopolitics"],
  ["taiwan-exercise", "news", "Will China hold a large-scale exercise around Taiwan this quarter?", "Official PLA announcement or Reuters confirmation.", "Reuters", 0.47, 22000, 280, 82400, "Geopolitics"],
  ["uk-pm", "news", "Will the UK PM still be in office at quarter end?", "No 10 confirmation of a resignation or leadership change.", "BBC", 0.62, 16000, 300, 57300, "UK Politics"],
  ["japan-election", "news", "Will the LDP lose its lower-house majority in the next election?", "Official election commission results.", "NHK", 0.35, 14000, 300, 48900, "Japan Politics"],
  ["india-election", "news", "Will the ruling party keep its majority in the next state elections?", "Election Commission of India results.", "ECI", 0.54, 13000, 300, 43600, "India Politics"],
  ["argentina-reform", "news", "Will Argentina's reform bill pass Congress this quarter?", "Official chamber vote record.", "Congreso", 0.39, 9800, 280, 31200, "LatAm"],
  ["brazil-rate", "news", "Will Brazil's central bank cut rates again this quarter?", "Copom statement.", "BCB", 0.57, 11000, 280, 35800, "LatAm"],
  ["ecb-cut", "news", "Will the ECB cut rates at its next meeting?", "ECB Governing Council decision.", "ECB", 0.61, 26000, 180, 92700, "Europe"],
  ["ecb-hold", "news", "Will the ECB hold rates unchanged through year end?", "No change across the remaining meetings.", "ECB", 0.34, 17000, 300, 61400, "Europe"],
  ["fed-chair", "news", "Will a new Fed chair be nominated this quarter?", "White House nomination sent to the Senate.", "White House", 0.43, 21000, 280, 74800, "US Politics"],
  ["ai-bill", "news", "Will the US pass federal AI regulation this session?", "Signed act reported by Congress.gov.", "Congress.gov", 0.19, 23000, 300, 79600, "AI Policy"],
  ["eu-ai-act", "news", "Will the EU AI Act implementing rules enter into force this month?", "EUR-Lex publication of the implementing act.", "EUR-Lex", 0.66, 18000, 240, 63200, "AI Policy"],
  ["immigration-bill", "news", "Will an immigration bill clear the Senate this quarter?", "Final Senate vote on Senate.gov.", "Senate.gov", 0.22, 15000, 300, 52600, "US Politics"],
  ["nato-spend", "news", "Will three more NATO members hit the 2% target this year?", "NATO annual defence expenditure report.", "NATO", 0.64, 12000, 300, 39800, "Defence"],
  ["nikkei-45k", "news", "Will the Nikkei close above 45,000 this quarter?", "Nikkei official close.", "Nikkei", 0.46, 16000, 300, 54700, "Markets"],
  ["gold-3k", "news", "Will gold hold above $3,000/oz through the week?", "LBMA PM fix, Friday.", "LBMA", 0.71, 20000, 120, 71200, "Commodities"],
  ["oil-90", "news", "Will Brent close above $90 this quarter?", "ICE Brent front-month settle.", "ICE", 0.33, 17000, 300, 58900, "Oil"],
  ["ceasefire-redsea", "news", "Will Red Sea shipping traffic recover above 60% of 2023 levels?", "IMF PortWatch weekly transit index.", "PortWatch", 0.28, 9000, 300, 27400, "Shipping"],
  ["nba-celtics", "sports", "Will the Celtics win their next game?", "NBA official final score.", "NBA", 0.72, 41000, 12, 167800, "NBA"],
  ["nba-lakers", "sports", "Will the Lakers make the play-in tournament?", "NBA standings at regular-season end.", "NBA", 0.58, 33000, 300, 124500, "NBA"],
  ["nba-mvp", "sports", "Will the MVP come from the Eastern Conference?", "NBA end-of-season award announcement.", "NBA", 0.55, 28000, 320, 98600, "NBA Awards"],
  ["nba-70win", "sports", "Will any team win 70 games this season?", "NBA final regular-season record.", "NBA", 0.14, 19000, 320, 64800, "NBA"],
  ["epl-arsenal", "sports", "Will Arsenal beat Chelsea in this round?", "Premier League official result.", "Premier League", 0.49, 33500, 40, 121500, "Premier League"],
  ["epl-title", "sports", "Will Arsenal win the Premier League title?", "Final league table.", "Premier League", 0.41, 46000, 320, 178300, "Premier League"],
  ["epl-city", "sports", "Will Man City finish above Liverpool?", "Final league table positions.", "Premier League", 0.53, 39000, 320, 148700, "Premier League"],
  ["epl-relegation", "sports", "Will all three promoted sides be relegated?", "Final league table.", "Premier League", 0.36, 22000, 320, 78200, "Premier League"],
  ["ucl-final", "sports", "Will a Spanish club reach the Champions League final?", "UEFA official results.", "UEFA", 0.57, 37000, 320, 139600, "UCL"],
  ["ucl-upset", "sports", "Will a non-top-5-league club reach the quarter-finals?", "UEFA official results.", "UEFA", 0.23, 18000, 320, 62800, "UCL"],
  ["f1-verstappen", "sports", "Will Verstappen win the next Grand Prix?", "FIA official classification.", "FIA", 0.46, 36000, 72, 131400, "F1"],
  ["f1-constructors", "sports", "Will McLaren win the constructors' title?", "FIA final standings.", "FIA", 0.61, 42000, 320, 158900, "F1"],
  ["f1-pole", "sports", "Will Norris take pole at the next qualifying?", "FIA qualifying classification.", "FIA", 0.38, 24000, 72, 86400, "F1"],
  ["f1-sprint", "sports", "Will a sprint weekend produce a different winner from the GP?", "FIA official results for that weekend.", "FIA", 0.52, 16000, 120, 54200, "F1"],
  ["nfl-chiefs", "sports", "Will the Chiefs win on the road this week?", "NFL official final score.", "ESPN", 0.55, 19800, 62, 64300, "NFL"],
  ["nfl-playoffs", "sports", "Will the Eagles make the playoffs?", "NFL final standings.", "ESPN", 0.68, 31000, 320, 112700, "NFL"],
  ["nfl-chiefs-sb", "sports", "Will the Chiefs reach the Super Bowl?", "AFC championship result.", "NFL", 0.29, 27000, 320, 94800, "NFL"],
  ["mlb-dodgers", "sports", "Will the Dodgers win the World Series?", "MLB official result.", "MLB", 0.31, 26000, 320, 91200, "MLB"],
  ["tennis-slam", "sports", "Will Alcaraz win the next Grand Slam?", "Official ATP tournament result.", "ATP", 0.34, 21000, 320, 74800, "Tennis"],
  ["tennis-wta", "sports", "Will Swiatek reach the final of the next WTA 1000?", "Official WTA results.", "WTA", 0.44, 15000, 200, 49600, "Tennis"],
  ["boxing-title", "sports", "Will the heavyweight title change hands this quarter?", "Official sanctioning body result.", "WBC", 0.37, 18000, 300, 61400, "Boxing"],
  ["ufc-main", "sports", "Will the champion retain in the next UFC main event?", "Official UFC result.", "UFC", 0.58, 22000, 60, 78200, "UFC"],
  ["mma-ko", "sports", "Will the UFC main event end by KO/TKO?", "Official UFC result method.", "UFC", 0.47, 17000, 60, 59800, "UFC"],
  ["olympics-host", "sports", "Will the next host city be confirmed on schedule?", "IOC official announcement.", "IOC", 0.81, 12000, 320, 38400, "Olympics"],
  ["cricket-ipl", "sports", "Will Mumbai Indians reach the IPL playoffs?", "Official IPL standings.", "IPL", 0.52, 14000, 300, 46200, "Cricket"],
  ["golf-major", "sports", "Will Scheffler win another major this year?", "Official PGA results.", "PGA", 0.39, 13000, 320, 41800, "Golf"],
  ["sports-scandal", "sports", "Will a top-10 club face a points deduction this season?", "Official league disciplinary ruling.", "League", 0.21, 11000, 320, 34600, "Football"],
  ["athletics-record", "sports", "Will a world record fall at the next Diamond League?", "World Athletics official ratification.", "World Athletics", 0.26, 9800, 120, 29800, "Athletics"],
  ["lol-t1", "esports", "Will T1 beat Movistar KOI in the Worlds knockout stage?", "Official Riot Games series result.", "LoL Esports", 0.63, 24600, 28, 97400, "LoL Worlds"],
  ["lol-worlds", "esports", "Will an LCK team win Worlds?", "Official tournament winner.", "LoL Esports", 0.58, 31000, 180, 108600, "LoL Worlds"],
  ["lol-final", "esports", "Will the Worlds final go to five games?", "Official series score.", "LoL Esports", 0.41, 18000, 180, 62400, "LoL Worlds"],
  ["cs2-major", "esports", "Will a European roster win the CS2 Major?", "Official HLTV-verified result.", "HLTV", 0.66, 22000, 160, 78200, "CS2"],
  ["cs2-upset", "esports", "Will a top-8 seed be eliminated in the group stage?", "Official HLTV standings.", "HLTV", 0.44, 16000, 120, 52800, "CS2"],
  ["cs2-map", "esports", "Will Mirage be the most-picked map at the Major?", "Official HLTV map statistics.", "HLTV", 0.49, 12000, 160, 38400, "CS2"],
  ["vct-sentinels", "esports", "Will Sentinels win their next VCT match 2:0?", "Official VCT match result.", "VCT", 0.28, 13200, 52, 33600, "VALORANT"],
  ["vct-final", "esports", "Will a Pacific team reach the VCT final?", "Official VCT bracket.", "VCT", 0.47, 17400, 180, 58600, "VALORANT"],
  ["dota-ti", "esports", "Will an Eastern European team win The International?", "Official Valve result.", "Valve", 0.42, 19800, 200, 67200, "Dota 2"],
  ["ow-final", "esports", "Will the OWCS champion come from NA?", "Official Blizzard results.", "Blizzard", 0.31, 9800, 180, 29400, "Overwatch"],
  ["rlcs-final", "esports", "Will a European team win RLCS?", "Official RLCS results.", "RLCS", 0.53, 8400, 180, 24800, "Rocket League"],
  ["evo-gf", "esports", "Will the EVO champion defend their title?", "Official EVO results.", "EVO", 0.36, 7600, 200, 21600, "Fighting Games"],
  ["lol-poro", "esports", "Will the tournament MVP be a mid laner?", "Official MVP announcement.", "LoL Esports", 0.45, 9200, 180, 26800, "LoL Worlds"],
  ["cs2-awp", "esports", "Will the tournament's top-rated player be an AWPer?", "Official HLTV rating leaderboard.", "HLTV", 0.51, 8800, 160, 24200, "CS2"],
  ["vct-viewership", "esports", "Will peak viewership beat last year's final?", "Official VCT viewership report.", "VCT", 0.56, 7400, 180, 20400, "VALORANT"],
  ["mobile-legend", "esports", "Will a Chinese team win the M-series title?", "Official Moonton result.", "Moonton", 0.64, 8200, 200, 22800, "Mobile Esports"],
  ["pubg-final", "esports", "Will the PUBG Nations Cup final go to the last circle?", "Official match log.", "PUBG", 0.38, 6800, 120, 18200, "PUBG"],
  ["apex-lan", "esports", "Will a new team win the Apex LAN?", "Official EA results.", "EA", 0.57, 6200, 160, 16800, "Apex"],
  ["fifa-esports", "esports", "Will a European player win the FC Pro title?", "Official EA Sports FC result.", "EA", 0.61, 6000, 180, 16200, "FC Pro"],
  ["fortnite-duo", "esports", "Will the FNCS duo final be won by a repeat champion?", "Official Epic results.", "Epic", 0.33, 5800, 180, 15400, "Fortnite"],
  ["esports-major-city", "esports", "Will the next Major be hosted outside Europe?", "Official tournament announcement.", "HLTV", 0.52, 5600, 240, 14800, "CS2"],
  ["valo-rank", "esports", "Will a rookie finish top-3 in ACS at the next LAN?", "Official VCT stats.", "VCT", 0.29, 5200, 180, 13600, "VALORANT"],
  ["lol-patch", "esports", "Will the next patch nerf the tournament's top pick?", "Official Riot patch notes.", "Riot", 0.47, 5000, 120, 12800, "LoL Worlds"],
  ["esports-prize", "esports", "Will the prize pool exceed last year's?", "Official tournament prize distribution.", "HLTV", 0.59, 4800, 240, 12400, "Esports"],
  ["ai-gpt6", "tech", "Will a frontier lab ship a GPT-5-class model this quarter?", "Official model release announcement from a top-3 lab.", "Lab blogs", 0.63, 38000, 280, 142600, "AI Models"],
  ["ai-gemini", "tech", "Will Gemini top the LMSYS arena this quarter?", "LMSYS Chatbot Arena leaderboard.", "LMSYS", 0.44, 29000, 280, 104200, "AI Models"],
  ["ai-llama", "tech", "Will Meta release a new open-weights model this quarter?", "Official Meta release.", "Meta", 0.58, 26000, 280, 92600, "Open Weights"],
  ["ai-agent-bench", "tech", "Will any agent score above 70% on SWE-bench Verified?", "Official leaderboard submission.", "SWE-bench", 0.36, 31000, 300, 114800, "Agent Benchmarks"],
  ["ai-context", "tech", "Will a production model ship a 10M-token context window?", "Provider documentation or release notes.", "Provider docs", 0.34, 18000, 300, 62400, "AI Models"],
  ["nvda-earnings", "tech", "Will Nvidia beat revenue consensus next quarter?", "Reported quarterly results vs. consensus.", "Nasdaq", 0.67, 42000, 240, 158300, "Semiconductors"],
  ["nvda-5t", "tech", "Will Nvidia market cap close above $5T this quarter?", "Nasdaq closing market cap.", "Nasdaq", 0.41, 36000, 300, 132400, "Semiconductors"],
  ["tsmc-2nm", "tech", "Will TSMC announce 2nm volume production this quarter?", "Official TSMC statement.", "TSMC", 0.49, 24000, 300, 86400, "Silicon"],
  ["chip-export", "tech", "Will the US tighten chip export controls this quarter?", "BIS Federal Register rule.", "BIS", 0.57, 27000, 280, 94800, "Policy"],
  ["asml-orders", "tech", "Will ASML bookings beat consensus?", "Reported quarterly bookings.", "ASML", 0.52, 16000, 240, 54800, "Silicon"],
  ["apple-glasses", "tech", "Will Apple announce AR glasses this quarter?", "Official Apple event or press release.", "Apple", 0.22, 21000, 300, 72800, "Consumer Tech"],
  ["apple-ai", "tech", "Will Apple ship a new on-device AI feature this quarter?", "Shipped OS release notes.", "Apple", 0.61, 19000, 280, 66400, "Consumer Tech"],
  ["tesla-fsd", "tech", "Will Tesla report a robotaxi milestone this quarter?", "Official Tesla disclosure.", "Tesla", 0.37, 23000, 300, 79800, "Autonomy"],
  ["spacex-starship", "tech", "Will Starship reach orbit on its next flight?", "Official SpaceX confirmation.", "SpaceX", 0.68, 20000, 180, 70200, "Space"],
  ["quantum-qubit", "tech", "Will a lab report a 1,000+ logical-qubit result this year?", "Peer-reviewed publication.", "arXiv", 0.27, 14000, 320, 46800, "Quantum"],
  ["humanoid-ship", "tech", "Will a humanoid robot ship to a paying customer this quarter?", "Company disclosure or customer announcement.", "Company blogs", 0.33, 17000, 300, 58200, "Robotics"],
  ["openai-ipo", "tech", "Will OpenAI file for an IPO this year?", "Public S-1 filing.", "SEC", 0.15, 25000, 320, 84600, "Markets"],
  ["ai-energy", "tech", "Will a hyperscaler announce a nuclear PPA this quarter?", "Company press release.", "Company blogs", 0.54, 13000, 280, 43200, "Energy"],
  ["ai-copyright", "tech", "Will a US court rule on AI training fair use this quarter?", "Published court opinion.", "CourtListener", 0.42, 15000, 300, 49600, "Law"],
  ["ai-model-ban", "tech", "Will a regulator ban a frontier model in a major market?", "Official regulatory order.", "Regulators", 0.18, 12000, 300, 39400, "Policy"],
  ["ai-voice", "tech", "Will a real-time voice model ship under 200ms latency?", "Provider documentation with measured latency.", "Provider docs", 0.47, 11000, 280, 36200, "AI Models"],
  ["robotics-cost", "tech", "Will a humanoid robot price fall below $30k this year?", "Published price from a shipping vendor.", "Vendors", 0.29, 9000, 320, 28800, "Robotics"],
  ["cyber-ransom", "tech", "Will a Fortune 500 disclose a $10M+ ransom payment?", "SEC 8-K or public disclosure.", "SEC", 0.24, 10000, 300, 32600, "Security"],
  ["data-center", "tech", "Will US data-centre power demand grow above 15% YoY?", "EIA reported figures.", "EIA", 0.62, 12000, 320, 39800, "Energy"],
  ["ai-benchmark", "tech", "Will an open model top a public coding benchmark this quarter?", "Official leaderboard.", "Leaderboards", 0.38, 11000, 300, 35400, "Open Weights"],
  ["tech-antitrust", "tech", "Will a major platform face a US antitrust remedy this quarter?", "Court order or DOJ/FTC action.", "DOJ", 0.31, 14000, 300, 44800, "Law"],
]

export const MARKET_COUNT = ROWS.length;

export const DEMO_MARKETS: DemoMarket[] = ROWS.map(([id, category, question, criteria, source, prob, depth, hours, volume]) => {
  const p = pool(prob, depth);
  return {
    id,
    question,
    category,
    criteria,
    source,
    yesReserve: p.yesReserve,
    noReserve: p.noReserve,
    resolutionAt: BOOT + Math.round(hours * HOUR),
    volumeUsdc: volume,
    isDemo: true as const,
  };
});

/** Markets for one vertical, in catalogue order. */
export function marketsOf(vertical: Vertical): DemoMarket[] {
  return DEMO_MARKETS.filter((m) => m.category === vertical);
}

/** Aggregate simulated volume, used by the hall's headline stats. */
export const DEMO_VOLUME_USDC = DEMO_MARKETS.reduce((acc, m) => acc + m.volumeUsdc, 0);
