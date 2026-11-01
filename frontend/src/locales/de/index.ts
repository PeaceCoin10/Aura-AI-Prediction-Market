import type { Messages } from "../en";

/**
 * German (de-DE) message tree. Mirrors `en` 1:1 — same keys, same nesting, same
 * array lengths, same placeholder names.
 *
 * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
 * Nothing here is computed at runtime; it is a static message tree.
 */

/** Uniform seed shape for the seeded debate threads, mirroring `en/content.ts`. */
const seed = (author: string, stance: string, text: string) => ({ author, stance, text });

export const de = {
  /** Shell copy: header, tabs, mode switch, sound, status bar, shared actions. */
  shell: {
    brand: {
      name: "Aura",
      wordmark: "AURA",
      tagline: "Agentische Prognosemärkte",
      descriptor: "KI-erstellte Märkte · CPMM-Preisbildung · Base Mainnet",
    },
    tabs: {
      feed: "Märkte",
      portfolio: "Portfolio",
      activity: "On-Chain",
      feedShort: "Märkte",
      portfolioShort: "Depot",
      activityShort: "Ereignisse",
    },
    nav: {
      hot: "Beliebt",
      crypto: "Krypto",
      news: "Nachrichten",
      sports: "Sport",
      esports: "E-Sport",
      tech: "Technik",
      other: "Sonstiges",
    },
    navHints: {
      hot: "Alle Kategorien, nach Aktivität sortiert",
      crypto: "Majors, DeFi und On-Chain-Flows",
      news: "Weltgeschehen, Geopolitik, Makro",
      sports: "NBA · NFL · Premier League · UCL",
      esports: "LoL · CS2 · VCT",
      tech: "KI, Halbleiter, Regulierung",
    },
    mode: {
      real: "Echtgeld",
      paper: "Paper",
      realTitle: "Echtgeld-Modus — Wallet verbinden und mit USDC auf Base handeln.",
      paperTitle: "Paper-Modus — 10,000 kostenlose FAKE-USDC. Keine Wallet, kein Risiko.",
      switchedPaper: "Paper-Modus aktiviert",
      switchedPaperBody:
        "10,000 FAKE-USDC gutgeschrieben. Off-Chain, null Risiko — testen Sie den kompletten Ablauf.",
      switchedReal: "Echtgeld-Modus aktiviert",
      switchedRealBody:
        "Wallet verbinden, um echte USDC auf Base zu handeln. Positionen sorgfältig dimensionieren.",
    },
    sound: {
      on: "Ton an — klicken zum Stummschalten",
      off: "Stumm — klicken zum Aktivieren",
    },
    actions: {
      connect: "Wallet verbinden",
      disconnect: "Trennen",
      switchChain: "Zu Base wechseln",
      switchFailed: "Netzwerkwechsel fehlgeschlagen",
      security: "Sicherheit",
      securityTitle: "Sicherheitsmatrix: Slither, Invarianten, Widerspruchsfrist",
      docs: "Doku",
      docsTitle: "Doku: Erste Schritte, KI-Architektur, SDK",
      refresh: "Aktualisieren",
      refreshing: "Aktualisiere…",
      close: "Schließen",
      affiliate: "Partner · 20 % der Gebühren",
      search: "Märkte, Kategorien, Teams suchen…",
      newMarket: "Neuer Markt",
      claimChips: "10,000 Chips sichern",
      resetChips: "Chips zurücksetzen",
      resetChipsTitle:
        "Paper-Guthaben auf 10,000 zurücksetzen und Paper-Positionen löschen",
      connectToView: "Wallet verbinden, um Positionen zu sehen",
    },
    status: {
      rpc: "Base RPC",
      rpcDown: "nicht erreichbar",
      brain: "Hermes-KI",
      heartbeat: "Zyklus aktiv",
      lastCycle: "letzter Zyklus vor {{min}}m",
      idle: "inaktiv — Wallet aufladen, um Märkte mit Liquidität zu versehen",
      security: "Sicherheitsmatrix",
      docs: "Doku-Portal",
    },
    locale: {
      label: "Sprache",
      active: "DE",
    },
    footer: {
      engine: "CentralPredictionEngine",
      chain: "Base · Chain 8453",
      fees: "1.5% Handelsgebühr / 0.5% Abrechnungsgebühr",
      dispute: "Widerspruchsfrist 1 Stunde",
      rights: "Open Source · MIT",
    },
    toasts: {
      copied: "In die Zwischenablage kopiert",
      copyFailed: "Kopieren fehlgeschlagen — Text manuell markieren",
    },
  },

  /** Hall (feed tab) copy: hero, stat strip, section headers, empty states, paper bar. */
  hall: {
    heroTitleA: "KI-Prognosemärkte",
    heroTitleB: "mit einer KI, die ihr Orderbuch selbst schreibt",
    heroBody:
      "Hermes entwirft alle fünf Minuten Märkte aus Live-Feeds zu Krypto, Nachrichten, Sport und E-Sport. Die Preisbildung übernimmt ein Constant-Product-Market-Maker auf Base — ein Multicall3-Read pro Aktualisierung, alle 15 Sekunden.",
    statsPaper: {
      featured: "Ausgewählte Märkte",
      cadence: "Tick-Intervall",
      cadenceValue: "7s",
      volume: "Simuliertes Volumen",
      chain: "On-Chain-Märkte",
    },
    statsReal: {
      chain: "On-Chain-Märkte",
      active: "Im Handel",
      liquidity: "Pool-Liquidität",
      featured: "Ausgewählte Märkte",
    },
    paperBar: {
      label: "Paper-Trading",
      balance: "Guthaben",
      hint: "Keine Wallet nötig — 12 ausgewählte Märkte, simulierte Live-Ticks, KI-Einschätzungen und die Debattenwand laufen bereits.",
      hintCount:
        "Keine Wallet nötig — {{count}} ausgewählte Märkte, simulierte Live-Ticks, KI-Einschätzungen und die Debattenwand laufen bereits.",
    },
    sections: {
      featuredTitle: "Ausgewählte Märkte",
      featuredBadge: "Off-Chain · voll handelbar",
      featuredNote:
        "Simulierte Ticks alle 7s · Kurse nutzen die echte CPMM-Mathematik",
      chainTitle: "Live auf der Chain",
      chainNote:
        "CentralPredictionEngine ist deployt und nicht pausiert, aber es wurde noch kein Markt angelegt. Die Hermes-KI benötigt USDC in ihrer Wallet, um Märkte zu erstellen und mit Liquidität zu versehen.",
      chainEmptyTitle: "Noch keine On-Chain-Märkte",
      chainEmptyBody:
        "Alles unten ist ein ausgewählter Markt: gleiche CPMM-Mathematik, gleicher Handelsablauf — nur lokal abgerechnet, damit Sie in Sekunden von null auf eine Position kommen.",
      demoEmptyTitle: "In dieser Kategorie noch keine Märkte",
      demoEmptyHint: "Zurück zu „Beliebt“ oder eine andere Kategorie wählen.",
      refreshFailed: "Aktualisierung fehlgeschlagen — letzter gültiger Stand:",
    },
    portfolio: {
      title: "Portfolio",
      subtitle:
        "Positionen sind das interne yesOf-/noOf-Ledger der Engine (ERC-1155-Semantik); Auszahlung über redeem().",
    },
    connect: {
      title: "Wallet verbinden",
      google: "Google",
      email: "E-Mail",
      socialNote: "Smart Account mit einem Tipp — die ersten Trades sind gasfrei.",
      body:
        "Die EIP-6963-Erkennung deckt jede injizierte Wallet ab — MetaMask, Coinbase, Rabby, jede EOA. Beim Verbinden wird der Wechsel zu Base Mainnet (8453) angefragt.",
      empty:
        "Keine Wallet-Erweiterung gefunden. MetaMask oder Coinbase Wallet installieren und neu laden — oder die ausgewählten Märkte oben mit Paper-Chips handeln.",
      connecting: "Verbinde…",
      failed: "Verbindung fehlgeschlagen",
    },
    paused:
      "Das Protokoll ist pausiert: neue Trades werden abgelehnt. Nur Abrechnung und Auszahlungen nach abgelaufener Widerspruchsfrist werden verarbeitet.",
  },

  /** Market copy and data-layer strings. */
  content: {
    /** Demo markets: the question a user reads, plus the criteria that settles it. */
    demoMarkets: {
      "demo-btc-88k": {
        question: "Bricht BTC innerhalb von 24 Stunden die Marke von $88,000?",
        criteria:
          "Wird mit YES abgerechnet, wenn der BTC/USD-Spotpreis zum Abrechnungszeitpunkt ≥ $88,000 beträgt (CoinGecko primär, Binance als Fallback); andernfalls NO.",
      },
      "demo-eth-etf": {
        question:
          "Verzeichnet ein Spot-ETH-ETF diese Woche an einem einzelnen Tag mehr als $500M Nettozuflüsse?",
        criteria:
          "Wird mit YES abgerechnet, wenn offizielle Zuflussdaten von Farside / SoSoValue an einem einzelnen Tag Nettozuflüsse über $500M ausweisen.",
      },
      "demo-defi-tvl": {
        question: "Erreicht das gesamte DeFi-TVL innerhalb von 48 Stunden wieder $120B?",
        criteria:
          "Wird mit YES abgerechnet, wenn der kettenübergreifende TVL-Snapshot zum Abrechnungszeitpunkt laut DefiLlama ≥ $120B beträgt.",
      },
      "demo-fed-cut": {
        question:
          "Erwähnt die Fed im nächsten FOMC-Statement ausdrücklich eine Zinssenkung?",
        criteria:
          "Wird mit YES abgerechnet, wenn das auf der Website der Federal Reserve veröffentlichte FOMC-Statement an irgendeiner Stelle eine Zinssenkung erwähnt; andernfalls NO.",
      },
      "demo-ceasefire": {
        question:
          "Bestätigen mindestens zwei große Medien diese Woche eine Waffenstillstandsvereinbarung?",
        criteria:
          "Wird mit YES abgerechnet, wenn mindestens zwei von Reuters, AP und BBC den Waffenstillstand vor dem Abrechnungszeitpunkt unabhängig melden; eine einzelne, mehrfach nachgedruckte Agenturmeldung zählt nicht als zweite Quelle.",
      },
      "demo-ai-act": {
        question:
          "Treten die Durchführungsbestimmungen zum EU AI Act diesen Monat in Kraft?",
        criteria:
          "Wird nur dann mit YES abgerechnet, wenn der Text im Amtsblatt (OJ) veröffentlicht wird; eine Zustimmung der Kommission ohne OJ-Veröffentlichung wird mit NO abgerechnet.",
      },
      "demo-nba-celtics": {
        question:
          "Besiegen die Boston Celtics heute Abend in der NBA die Brooklyn Nets?",
        criteria:
          "Wird nach dem offiziellen ESPN-Endstand abgerechnet (inklusive Overtime): Sieg der Celtics → YES; Niederlage oder Gleichstand → NO; Verschiebung um mehr als 24 Stunden → INVALID und rückerstattet.",
      },
      "demo-epl-derby": {
        question: "Gewinnt Arsenal in dieser Premier-League-Runde gegen Chelsea?",
        criteria:
          "Wird nach dem offiziellen Premier-League-Endstand abgerechnet (inklusive Nachspielzeit): Sieg Arsenal → YES; Unentschieden oder Niederlage → NO.",
      },
      "demo-nfl-chiefs": {
        question: "Gewinnen die Kansas City Chiefs auswärts?",
        criteria:
          "Wird nach dem offiziellen NFL-Endstand abgerechnet: Sieg der Chiefs → YES; Gleichstand oder Niederlage → NO.",
      },
      "demo-lol-t1": {
        question: "Besiegt T1 Movistar KOI in der K.-o.-Phase der Worlds?",
        criteria:
          "Wird nach dem offiziellen LoL-Esports-Ergebnis (gameWins) abgerechnet: T1 gewinnt die Serie → YES; andernfalls NO.",
      },
      "demo-cs2-major": {
        question:
          "Gewinnt die europäische Region in der Gruppenphase des CS2 Major mehr als 60% ihrer Matches?",
        criteria:
          "Laut offiziellen HLTV-Event-Statistiken: Siegquote Europas zum Abrechnungszeitpunkt über 60% → YES; andernfalls NO.",
      },
      "demo-valorant": {
        question: "Gewinnen die Sentinels ihr nächstes VCT-Match mit 2:0?",
        criteria:
          "Laut offiziellem VCT-Ergebnis: genau 2:0 → YES; jedes andere Ergebnis → NO.",
      },
    },

    /**
     * Seeded debate-wall posts. Cold-start filler for the built-in demo markets only,
     * labelled as official topics in the UI — never passed off as real users.
     */
    seedComments: {
      "demo-btc-88k": [
        seed("0xWhale", "YES", "ETF-Zuflüsse stapeln sich weiter. 88k ist nur eine Frage der Zeit, und 24h sind reichlich."),
        seed("Satoshi_Cat", "NO", "Bei 86k liegt eine fette Liquidationswand. Da kommt er nicht durch."),
      ],
      "demo-eth-etf": [
        seed("defi_researcher", "YES", "Wenn ein Staking-ETF durchkommt, sind $500M an einem Tag nichts."),
      ],
      "demo-fed-cut": [
        seed("MacroHound", "NO", "Der Dot Plot ist weiter hawkish. Das Statement wird das Wort Senkung nicht verwenden."),
        seed("Bond_Trader", "YES", "Die Inflationsdaten sind gekippt. Die Wahrscheinlichkeit für weichere Formulierungen liegt schon bei 40%."),
      ],
      "demo-nba-celtics": [
        seed("courtside_vet", "YES", "Heimvorteil gegen ein Team im Back-to-Back. Das ist eindeutig."),
      ],
      "demo-lol-t1": [
        seed("RiftAnalyst", "YES", "T1s Draft-Vorbereitung ist tiefer. Der BO5-Erfahrungsvorsprung ist real."),
        seed("KOI_faithful", "NO", "Dieser Patch begünstigt KOIs frühes Tempo. Die Überraschung kommt."),
      ],
    },

    /** Local rule-engine commentary. Only uses pool state: probability, depth, volume, time left. */
    insights: {
      flavor: {
        crypto: "die On-Chain-Flows",
        news: "der Nachrichtenticker",
        tech: "die Tech-Story",
        sports: "der Sportmarkt",
        esports: "die E-Sport-Meta",
        fallback: "das Orderbuch",
      },
      crowded:
        "YES steht bereits bei {{prob}}% — die Long-Seite ist extrem überfüllt. Ein Kauf hier bedeutet, dass die Quoten nicht mehr für Sie sprechen; ein einzelner großer Verkauf kann einen zweistelligen Drawdown erzeugen.",
      edge:
        "Longs haben bei {{prob}}% einen leichten Vorteil, doch {{flavor}} hat noch kein entscheidendes Signal geliefert — lieber schrittweise einsteigen als alles auf einmal.",
      neutral:
        "Die Wahrscheinlichkeit liegt bei {{prob}}%, exakt in der Mitte des neutralen Bands: Beide Seiten warten auf neue Informationen. Liquiditätsanbieter fühlen sich hier am wohlsten; Taker werden in beide Richtungen ausgestoppt.",
      fade:
        "Shorts führen knapp (YES {{prob}}%). Das ist eine günstige Struktur, die aber einen Katalysator braucht — nur eine kleine Wette auf die Umkehr hat die richtige Auszahlung.",
      priced:
        "YES ist auf {{prob}}% gefallen — der Markt hat dieses Ergebnis nahezu vollständig eingepreist. Ohne einen Schwarzschwan-Umschwung bei {{flavor}} bleibt im Residualwert wenig übrig.",
      thinPool:
        " Die Pool-Tiefe beträgt nur {{depth}} USDC — 100 USDC bewegen den Preis, beachten Sie die Impact-Kosten.",
      heavyVolume:
        " Das Volumen ({{vol}} USDC) entspricht bereits dem {{multiple}}x der Pool-Tiefe — der Umschlag ist hoch.",
      closingSoon:
        " Weniger als 1 Stunde bis zur Abrechnung — sobald die Widerspruchsfrist beginnt, sind Auszahlungen gesperrt.",
      finalHours:
        " Noch {{hours}} Stunden bis zur Abrechnung; die letzte Phase ist meist die volatilste.",
      basis: "Wahrsch. {{prob}}% · Tiefe {{depth}} USDC · Vol. {{vol}} USDC",
    },

    /** Event names as shown on toasts and the activity feed. */
    eventLabels: {
      MarketCreated: "Markt erstellt",
      MarketCategoryUpdated: "Kategorie aktualisiert",
      LiquiditySeeded: "Liquidität bereitgestellt",
      SharesBought: "Kauf ausgeführt",
      SharesSold: "Verkauf ausgeführt",
      MarketResolved: "Markt festgestellt",
      DisputeWindowOpened: "Widerspruchsfrist eröffnet",
      ResolutionOverridden: "Feststellung überschrieben",
      ResolutionFinalized: "Feststellung abgeschlossen",
      Redeemed: "Einlösung ausgezahlt",
      ResidualSwept: "Restbetrag entnommen",
      FeeVaultUpdated: "Gebühren-Vault aktualisiert",
      TreasuryUpdated: "Treasury aktualisiert",
      CreatorUpdated: "Ersteller-Berechtigung geändert",
      OracleUpdated: "Oracle-Berechtigung geändert",
      Paused: "Protokoll pausiert",
      Unpaused: "Protokoll fortgesetzt",
      AdminTransferStarted: "Admin-Übergabe gestartet",
      AdminTransferred: "Admin übergeben",
    },

    /** Feed / toast bodies. `{{var}}` is substituted from decoded event args. */
    eventFeed: {
      createdTitle: "{{label}}: {{question}}",
      createdBody: "Kategorie {{category}} · Abrechnung {{when}}",
      liquidityBody: "{{amount}} USDC in den Pool eingebracht",
      tradeTitle: "{{label}} · {{outcome}}",
      buyBody: "{{amount}} USDC gezahlt → {{shares}} Shares erhalten (Gebühr {{fee}})",
      sellBody: "{{shares}} Shares verkauft → {{amount}} USDC erhalten",
      resolvedTitle: "{{label}}: {{outcome}}",
      resolvedBody: "Widerspruchsfrist 1 Stunde — Safe kann überschreiben",
      resolvedBodyEmergency: "Notfall-Rückerstattung möglich",
      disputeBody: "Widerspruchsfrist bis {{when}}; Einlösungen sind solange gesperrt",
      overrideTitle: "{{label}}: {{from}} → {{to}}",
      overrideBody: "Ergebnis {{count}}-mal überschrieben",
      redeemedBody: "Auszahlung {{payout}} USDC (verbrannt YES {{yes}} / NO {{no}})",
      pausedBody:
        "Handel und Einlösungen pausiert (ausgenommen Notfall-Auszahlungsfenster)",
    },

    /** Resolution wording, shared by the feed and the market cards. */
    outcomes: {
      yesWins: "YES gewinnt",
      noWins: "NO gewinnt",
      invalid: "Ungültig (0.5 pro Share ausgezahlt)",
    },

    /** Market lifecycle labels; keys mirror `MarketPhase`. */
    phase: {
      trading: "Handel",
      awaiting: "Wartet auf Feststellung",
      disputing: "Widerspruchsfrist",
      final: "Abgeschlossen",
      closed: "Geschlossen",
      empty: "Nicht gefunden",
    },

    /** Paper-trading failures, shown inline next to the trade button. */
    paper: {
      amountPositive: "Betrag muss größer als 0 sein",
      insufficientBalance:
        "Paper-Guthaben reicht nicht — fordern Sie zuerst Ihre 10,000 FAKE-USDC an",
      noShares:
        "Dieser Betrag kauft keine Shares — Pool zu dünn oder Betrag zu klein",
      noPosition: "Keine Paper-Position in diesem Markt",
      exceedsPosition: "Verkaufsmenge übersteigt Ihre Position",
      depthTooThin: "Die aktuelle Tiefe kann diesen Verkauf nicht aufnehmen",
    },

    /** Wallet errors surfaced through the connect flow. */
    wallet: {
      noProvider:
        "Keine Wallet-Erweiterung gefunden — MetaMask oder Coinbase Wallet installieren",
      noAccounts: "Wallet hat keine Konten zurückgegeben",
      notConnected: "Wallet nicht verbunden",
      fallbackName: "Browser-Wallet",
      hookOutsideProvider: "useWallet muss innerhalb von <WalletProvider> verwendet werden",
    },

    mode: {
      hookOutsideProvider: "useMode muss innerhalb von <ModeProvider> verwendet werden",
    },

    /** Shared formatting strings. */
    format: {
      expired: "Abgelaufen",
      unknownError: "Unbekannter Fehler",
      dayUnit: "T",
    },

    /** Slippage preset hints. */
    slippage: {
      conservative: "Konservativ",
      default: "Standard",
      aggressive: "Aggressiv",
    },

    /** Share poster + X intent copy. */
    poster: {
      tagline: "AGENTISCHES DEFI · KI-PROGNOSEMÄRKTE",
      modePaper: "Paper",
      modeReal: "Echtgeld",
      sideNeutral: "Beobachtet",
      sideBet: "Wette auf {{side}}",
      probLabel: "Aktuelle YES-Wahrscheinlichkeit",
      returnLabel: "Mögliche Rendite",
      scanQr: "Scannen, um den Markt zu öffnen",
      footer:
        "Base Mainnet · Verträge verifiziert · Widerspruchsfrist 1 Stunde · 1.5% Handelsgebühr",
      canvasUnavailable: "Canvas nicht verfügbar",
      tweetLeadNeutral: "Beobachtet",
      tweetLeadBet: "Wette auf {{side}}",
      tweet:
        '{{lead}} „{{question}}“ | YES bei {{prob}}%{{potential}} #AIPredictionMarkets #Base #Aura',
      tweetPotential: ", mögliche Rendite {{ret}}",
    },
  },

  /**
   * Security namespace — the first-run risk disclosure, the security matrix drawer
   * and the docs portal. This block is a compliance surface: literal and unambiguous,
   * never rounded.
   *
   * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  security: {
    common: {
      close: "Schließen",
    },

    /** First-run risk acknowledgement. Shown once, keyed by `aura.risk.ack.v1`. */
    risk: {
      title: "Risikohinweis und Nutzungsbedingungen",
      bulletProtocol:
        "Aura ist ein dezentrales Prognosemarkt-Protokoll. Aura ist kein Anlageberater, und nichts hier stellt eine Anlageberatung dar.",
      bulletPrice:
        "Share-Preise werden von einer AMM-Kurve bestimmt und können auf null fallen. Setzen Sie nur USDC ein, deren Verlust Sie verkraften können.",
      bulletDispute:
        "Die Abrechnung umfasst eine Widerspruchsfrist von 1 Stunde. In dieser Zeit sind Auszahlungen gesperrt, und das Safe-Multisig kann das Ergebnis innerhalb dieses Fensters überschreiben.",
      bulletPaper:
        "Der Paper-Modus läuft mit lokalen virtuellen Chips. Es sind keine echten Vermögenswerte beteiligt, und Chips können nicht eingelöst werden.",
      bulletAudit:
        "Die Verträge sind Open Source und auf Base Mainnet verifiziert, doch kein Audit kann null Risiko garantieren.",
      consent:
        "Mit dem Fortfahren bestätigen Sie, diese Bedingungen gelesen zu haben und zu akzeptieren, und dass Ihre Jurisdiktion die Teilnahme an Produkten dieser Art zulässt.",
      ack: "Risiko verstanden — zu den Märkten",
    },

    /** Security matrix drawer: Slither, invariants, dispute window, Safe override. */
    drawer: {
      title: "Sicherheitsmatrix",
      slither: {
        title: "Statische Analyse · Slither",
        high: "Hoch",
        medium: "Mittel",
        low: "Niedrig",
      },
      tests: {
        title: "Testmatrix",
        forgeLead: "forge test — ",
        forgeTail: " Tests grün (Unit + Invariant)",
        invariantLead: "Invariant-Tests: ",
        invariantRunsDepth: " Runs × Tiefe ",
        invariantCallsLead: ", ",
        invariantTail:
          " Handler-Aufrufe ausgeführt (≈12,800 pro Selektor über 8 Selektoren), 0 Reverts, 0 Invariant-Verletzungen",
        coverage:
          "SDK: 70/70 Offline-Fälle · Frontend: 11/11 Live-Chain-E2E + 55/55 UI-E2E",
      },
      economics: {
        title: "Wirtschaftliche und Governance-Kontrollen",
        feeLead: "Gebühren: ",
        feeTail:
          " — vollständig an den ProtocolFeeVault; Auszahlungen erfordern eine Safe-Signatur",
        disputeLead: "Widerspruchsfrist: ",
        disputeTail:
          ", beginnt in dem Moment, in dem ein Markt festgestellt wird; Auszahlungen bleiben für die Dauer gesperrt",
        overrideLead: "Überschreiben: ",
        emergencyLead: "Notfall: ",
        emergencyWindow: "7 Tage",
        emergencyMid: " nach dem Abrechnungszeitpunkt kann jeder ",
        emergencyTail: " für eine vollständige Rückerstattung aufrufen",
      },
      verified: {
        title: "Verifizierte Verträge (Base Mainnet)",
        badge: "✓ Verifiziert",
      },
    },

    /** Docs portal: getting started, AI architecture, SDK integration. */
    docs: {
      title: "Doku-Portal",
      tabs: {
        start: "Erste Schritte",
        brain: "Hermes-KI-Architektur",
        sdk: "SDK-Integration",
      },

      start: {
        headingPaper: "Von null zur Position in 3 Sekunden (ohne Wallet)",
        paperSteps: [
          "Schalten Sie den Umschalter oben rechts auf Paper → 10,000 Chips anfordern.",
          "Wählen Sie einen Markt in der Marktübersicht und kaufen Sie YES oder NO — Shares, Durchschnittspreis und Preiseinfluss werden live berechnet.",
          "Das Positionspanel verfolgt den unrealisierten PnL in Echtzeit; ein Verkauf schreibt den Betrag direkt Ihrem Guthaben gut.",
        ],
        headingReal: "Echtgeld-Handel",
        realSteps: [
          "Auf Echtgeld umschalten → Wallet verbinden (wechselt zu Base, Chain 8453).",
          "Markt wählen → USDC-Betrag eingeben → der erste Trade erfordert eine Genehmigung, die das Panel für Sie übernimmt.",
          "Ein Toast liefert den Transaktions-Hash; öffnen Sie ihn auf Basescan.",
          "Sobald ein Markt festgestellt ist, beginnt die Widerspruchsfrist von 1 Stunde; die Einlösung öffnet, wenn das Fenster endet.",
        ],
        headingFees: "Gebühren und Abrechnung",
        feesBody:
          "Auf Trades werden 1.5% erhoben, auf Abrechnungsauszahlungen 0.5%. Preis = NO-Reserve / Gesamtreserve, und ein einzelner Trade ist auf 5% der Pool-Tiefe begrenzt.",
      },

      brain: {
        headingEngines: "Drei Engines, eine Schleife",
        creator: "Creator",
        creatorBody:
          ": Multi-Venue-Ingest (CoinGecko/Binance, RSS-News, ESPN-Scoreboard, LoL Esports) → YES/NO-Binärfragen → Markterstellung mit Market-Making-Liquidität",
        oracle: "Oracle",
        oracleBody:
          ": Preismärkte benötigen 3×30s Multi-Sample-Reads, um Wicks abzufangen; Sport und E-Sport werden nur bei offiziellen Ergebnissen festgestellt; Nachrichtenmärkte werden nie automatisch festgestellt — sie warten auf das Safe oder einen manuellen Aufruf",
        marketing: "Marketing",
        marketingBody:
          ": Jeder neue Markt erhält Twitter-/Telegram-Texte aus einer Template-Engine, optional mit LLM-Durchlauf",
        headingConstraints: "Harte Vorgaben für die Fragestellung",
        constraintsBody:
          "Binäre Formulierung (wird es / wird es nicht), Abrechnung zwischen 30 Minuten und 8 Tagen im Voraus und ein objektives Feststellungskriterium. Alles andere wird verworfen.",
        headingCommentary: "Kommentar",
        commentaryLead:
          "In jedem Zyklus schreibt die KI Kommentare zu echten Märkten in ",
        commentaryTail:
          "; das Frontend fragt alle 60 Sekunden ab. Ist die KI offline, greift das Frontend auf seine Regel-Engine zurück und kennzeichnet die Ausgabe als Lokale Inferenz.",
      },

      sdk: {
        headingInstall: "Installieren und verbinden",
        headingRead: "Märkte lesen (ein Multicall3)",
        headingOrder: "Order platzieren",
        footnote:
          "Offline-Quoting ist im SDK als previewBuyOffline / previewSellOffline enthalten, wei-genau abgestimmt auf das On-Chain-previewBuy; decodeLogs wandelt Roh-Events in strukturierte Benachrichtigungen um.",
      },
    },
  },

  /**
   * Trade namespace — on-chain market detail and the real trading panel.
   *
   * Venue vocabulary (depth, impact, slippage, CPMM) stays terse; numbers, fees and
   * windows are contract facts and must not be rounded. No exclamation marks.
   *
   * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  trade: {
    common: {
      close: "Schließen",
    },

    /** Market detail sheet: header chips, on-chain data table, settlement rules. */
    market: {
      onChainChip: "On-Chain-Markt",
      settlesPrefix: "Abrechnung ",
      inPrefix: "in ",
      untitled: "Markt ohne Titel",
      shareFallbackQuestion: "KI-Prognosemarkt",
      dataTitle: "Marktdaten (direkt on-chain gelesen)",
      yesProb: "YES-Wahrscheinlichkeit",
      noProb: "NO-Wahrscheinlichkeit",
      yesReserve: "YES-Reserve",
      noReserve: "NO-Reserve",
      cash: "Pool-Barbestand",
      owed: "Gesamtverbindlichkeiten",
      volume: "Kumuliertes Volumen",
      tradable: "Handelbar",
      yes: "Ja",
      no: "Nein",
      status: "Abrechnungsstatus",
      statusFinalized: "Festgestellt",
      statusDispute: "Im Widerspruch",
      statusUnresolved: "Nicht festgestellt",
      outcome: "Ergebnis",
      rulesTitle: "Regeln",
      rulePricing:
        "Preis = NO-Reserve / Gesamtreserve. Trades laufen über den CPMM, und eine einzelne Order ist auf 5% der Pool-Tiefe begrenzt.",
      ruleFees:
        "Auf das Handelsvolumen werden 1.5% Gebühr erhoben; auf Abrechnungsauszahlungen 0.5%.",
      ruleDispute:
        "Die Feststellung eröffnet eine Widerspruchsfrist von 1 Stunde. Das Safe (Admin) kann das Ergebnis überschreiben, Auszahlungen sind währenddessen geschlossen.",
      ruleEmergency:
        "Ist ein Markt 7 Tage nach seinem Abrechnungszeitpunkt noch nicht festgestellt, kann jeder emergencyRefund für eine vollständige Rückerstattung aufrufen.",
    },

    /** Trade panel: quote strip, dispute banner, redeem block, order form, confirm dialog. */
    panel: {
      poolDepth: "Pool-Tiefe",
      disputeLeft: "Widerspruch endet in",
      settlesIn: "Abrechnung in",
      finalized: "Festgestellt",
      awaitingFinalize: "Wartet auf Abschluss",

      disputeTitle:
        "Innerhalb der Widerspruchsfrist von 1 Stunde. Das Safe kann das Ergebnis noch überschreiben, Auszahlungen sind geschlossen.",
      disputeBodyLead: "Widerspruch endet in ",
      disputeBodyMid:
        ", danach wird automatisch abgeschlossen — jeder kann ",
      disputeBodyTail: " aufrufen, um das Abschluss-Event zu schreiben.",

      position: "Ihre Position",
      redeemTitleClosed: "Auszahlungen sind während der Widerspruchsfrist geschlossen",
      redeemDispute: "Auszahlung während des Widerspruchs gesperrt",
      redeemReady: "Gewinn einlösen",
      redeemEmpty: "Keine einlösbare Position",
      redeemNote:
        "Abrechnungsgebühr 0.5%. Ein INVALID-Markt zahlt 0.5 USDC pro YES- und pro NO-Share. Solange das Protokoll pausiert ist, wird die erzwungene Auszahlung 7 Tage nach dem Abrechnungszeitpunkt freigeschaltet.",

      buyShares: "Shares kaufen",
      sellShares: "Shares verkaufen",
      amountInLabel: "USDC-Einsatz",
      sellLabel: "Zu verkaufende Shares",
      sellable: " (max. {{amount}})",
      unitUsdc: "USDC",
      unitShares: "Shares",
      max: "Max",

      slippage: "Slippage",
      capHint: "Limit pro Trade ≈ {{amount}} USDC (5% der Tiefe)",

      quoteReceive: "Sie erhalten",
      quoteReturn: "Sie erhalten zurück",
      quoteChain: "· On-Chain-Kurs",
      quoteOffline: "· Offline-Schätzung",
      unitSharesSuffix: " Shares",
      avgFill: "Durchschnittlicher Ausführungspreis",
      pricePerShare: "USDC/Share",
      priceImpact: "Preiseinfluss",
      impactCap: " / 5%-Limit",
      tradingFee: "Handelsgebühr",
      feeOnChain: " (on-chain abgezogen)",
      protectedPrice: "Geschützter Preis",
      protectedPriceValue: "{{amount}} (-{{slip}})",
      impactWarnLead: "Der Preiseinfluss liegt bei 80% des Limits (SDK-Warnung ",
      impactWarnMid: "). Eine größere Order wird abgelehnt von ",
      impactWarnTail: " — verkleinern oder die Order aufteilen.",

      submitSettled: "Markt festgestellt",
      submitClosed: "Handel geschlossen",
      buy: "{{side}} kaufen",
      sell: "{{side}} verkaufen",
      connectToTrade: "Wallet verbinden, um zu handeln",

      confirmTitle: "Preiseinfluss nahe am harten Limit",
      confirmBodyLead: "Das SDK hat ",
      confirmBodyMid: " zurückgegeben — diese Order beansprucht ",
      confirmBodyTail:
        "% der Pool-Tiefe (Vertragslimit 5%). Die Ausführung wird deutlich schlechter ausfallen und bewegt echtes Geld.",
      confirmReduce: "Größe reduzieren",
      confirmProceed: "Trotzdem ausführen",

      footerUsdc: "USDC",
      footerEngine: "Engine",
      footerNote: "On-Chain-Abrechnung, unwiderruflich",
    },

    /** Toast titles and bodies emitted while a transaction is in flight. */
    toasts: {
      allowanceChecking: "USDC-Freigabe wird geprüft",
      allowanceBody: "spender = CentralPredictionEngine",
      submitted: "Transaktion übermittelt, wartet auf Bestätigung…",
      reverted: "Transaktion zurückgesetzt (status = reverted)",
      confirmedEvent: "On-Chain bestätigt: {{event}}",
      confirmed: "On-Chain bestätigt",
      tradeFailed: "Trade fehlgeschlagen",
      connectFirst: "Zuerst Wallet verbinden",
      amountRequired: "Betrag eingeben",
      redeemSubmitted: "Einlösung übermittelt",
      redeemConfirmed: "Einlösung bestätigt",
      redeemFailed: "Einlösung fehlgeschlagen",
    },
  },

  /**
   * Paper trading: featured market card, sample-market detail, buy/sell panel, paper account.
   *
   * Honesty contract: chips are local, quotes reuse the real CPMM maths, and nothing
   * settles on-chain. No label may imply otherwise.
   */
  paper: {
    card: {
      held: "Gehalten",
      yesProbability: "YES-Wahrscheinlichkeit",
      noProbability: "NO-Wahrscheinlichkeit",
      tickTitle: "Quoten aktualisieren alle 7 Sekunden",
      depth: "Tiefe {{amount}} USDC",
      settlePrefix: "Abrechnung ",
      expired: "Abgelaufen",
      volume: "Volumen {{amount}} USDC",
      debate: "💬 Debatte {{count}}",
      aiTag: "◈ KI",
      paperValue: "Paper-Wert {{amount}} FAKE",
      sample: "Beispiel",
      tickNote: "7-s-Takt · Papier-Fills",
      byAuthor: "— {{author}}",
    },
    detail: {
      offchainBadge: "Off-Chain · Papier-Abrechnung",
      settledAt: "Abrechnung {{time}}",
      remainingPrefix: "In ",
      close: "Schließen",
      bookTitle: "Marktdaten",
      yesProbability: "YES-Wahrscheinlichkeit",
      noProbability: "NO-Wahrscheinlichkeit",
      yesReserve: "YES-Reserve",
      noReserve: "NO-Reserve",
      volume: "Kumuliertes Volumen",
      source: "Datenquelle",
      mathNote:
        "Die Wahrscheinlichkeit ist der vom CPMM implizierte Preis; das Frontend verschiebt das Orderbuch alle 7 Sekunden minimal und kennzeichnet es als simuliert.",
      criteriaTitle: "Feststellungskriterien",
    },
    panel: {
      badge: "Paper-Modus",
      balance: "Guthaben {{amount}} FAKE-USDC",
      claim: "10,000 Chips anfordern",
      reset: "Zurücksetzen",
      resetTitle: "Paper-Konto zurückgesetzt",
      resetBody: "Chips auf 10,000 FAKE-USDC zurückgesetzt",
      buyYes: "YES · {{prob}}",
      buyNo: "NO · {{prob}}",
      amountLabel: "Betrag in FAKE-USDC",
      amountPlaceholder: "0.00",
      max: "Max",
      slippage: "Slippage",
      estShares: "Geschätzte Shares",
      avgPrice: "Durchschnittspreis",
      marginalPrice: "Grenzpreis",
      minReceived: "Mindestbetrag (Slippage-Schutz)",
      impact: "Preiseinfluss",
      impactWarning:
        "⚠ Warnung: impact_near_limit — Preiseinfluss {{impact}}, nahe am 5%-Limit des Vertrags. Eine aufgeteilte Order ist günstiger.",
      buy: "{{side}} kaufen",
      sell: "{{side}} verkaufen ({{shares}})",
      insufficientChips:
        "Nicht genug Chips (Guthaben {{amount}}). Zuerst anfordern oder zurücksetzen.",
      boardTitle: "Paper-Position · PnL",
      boardEmpty: "Noch keine Paper-Position — Ihr nächster Fill erscheint hier.",
      yesShares: "YES-Shares",
      noShares: "NO-Shares",
      invested: "Gesamteinsatz",
      markValue: "Marktwert (Cash-out)",
      disclaimer:
        "Paper-Modus: echte CPMM-Mathematik, lokale Chips. Off-Chain, nicht auszahlbar, keine echten Vermögenswerte.",
      errorTitleBuy: "Paper-Order fehlgeschlagen",
      errorTitleSell: "Paper-Verkauf fehlgeschlagen",
      toastBuyTitle: "Paper-Kauf {{side}} ausgeführt",
      toastBuyBody:
        "{{amount}} FAKE-USDC → {{shares}} Shares · Ø ${{price}} · off-chain, keine Kosten",
      toastSellTitle: "Paper-Verkauf {{side}} ausgeführt",
      toastSellBody:
        "{{shares}} Shares → {{proceeds}} FAKE-USDC zurück im Guthaben",
    },
    account: {
      title: "Paper-Konto",
      badge: "Paper-Trading",
      summary: "Guthaben {{balance}} FAKE-USDC · Positionswert {{value}}",
      unrealized: "Unrealisiert",
      claim: "10,000 Chips anfordern",
      reset: "Paper-Konto zurücksetzen",
      empty:
        "Noch keine Paper-Positionen. Geben Sie eine Order in einem beliebigen Markt der Marktübersicht auf — Marktwert und PnL laufen hier ein, alles lokal abgerechnet, ohne Kosten.",
      rowMeta: "YES {{yes}} / NO {{no}} · Einsatz {{spent}} · Wert {{value}}",
      footnote:
        "Der Paper-Modus rechnet die echte CPMM-Kurve lokal. Chips sind nicht auszahlbar und nicht übertragbar; nur der Echtgeld-Modus bewegt tatsächliche USDC.",
    },
  },

  /**
   * Portfolio, on-chain activity feed, market creation.
   *
   * Real-money surfaces: every label has to be unambiguous about what is on-chain
   * (shares, balances, dispute windows) versus what is presentation.
   */
  portfolio: {
    positions: {
      title: "Positionen",
      connectTitle: "Wallet verbinden, um Positionen zu sehen",
      connectHint:
        "Positionen liegen im On-Chain-ERC-1155-Ledger der Engine (yesOf / noOf). Nichts wird lokal zwischengespeichert.",
      usdcBalance: "USDC-Guthaben",
      unsettled: "Nicht abgerechnet (Shares)",
      sharesUnit: "Shares",
      redeemable: "Einlösbare Märkte",
      marketsUnit: "Märkte",
      disputingUnit: "· {{count}} im Widerspruch",
      disputeTitle: "{{count}} Markt in der Widerspruchsfrist von 1 Stunde",
      disputeTitlePlural:
        "{{count}} Märkte in der Widerspruchsfrist von 1 Stunde",
      disputeBody:
        "Das Safe kann das Ergebnis während der Widerspruchsfrist von 1 Stunde noch überschreiben, deshalb sind Auszahlungen gesperrt. Die Einlösung öffnet, sobald der Countdown endet oder jemand aufruft",
      readingShares: "Shares werden gelesen…",
      emptyTitle: "Noch keine Positionen",
      emptyHint:
        "Wählen Sie einen Markt in der Marktübersicht und kaufen Sie YES / NO — Fills landen sofort on-chain.",
      groupRedeemable: "Einlösbar",
      groupDisputing: "Im Widerspruch",
      groupOpen: "Offen",
      untitled: "(Markt ohne Titel)",
      yesPrice: "YES {{price}}",
      settles: "Abrechnung {{time}}",
      disputeLabel: "Widerspruch",
      redeem: "Einlösen",
      locked: "Gesperrt",
      lockedTitle: "Während der Widerspruchsfrist nicht einlösbar",
      trade: "Handeln",
    },
    activity: {
      title: "On-Chain-Event-Feed",
      subtitle:
        "SDK-decodeLogs parst Roh-Logs · inkrementelles eth_getLogs alle 8s",
      error: "Log-Abruf fehlgeschlagen: {{error}}",
      emptyTitle: "Noch keine Events erfasst",
      emptyHint:
        "Hat die Engine seit dem Deployment keine Markterstellungen oder Fills gehabt, bleibt das Log leer. Das erste createMarket / SharesBought erscheint hier in Echtzeit.",
      txLink: "Transaktion ansehen →",
      decodeTitle: "decodeLog(args)",
    },
    create: {
      open: "+ Neuer Markt",
      title: "Neuer Markt",
      subtitle:
        "marketId = keccak256(question|category|timestamp). Erfordert die CREATOR-Rolle; nach dem On-Chain-Schreiben unveränderlich.",
      questionLabel: "Frage (8–280 Byte)",
      questionPlaceholder:
        "z. B. Bricht BTC innerhalb von 24 Stunden die Marke von $81,000?",
      categoryLabel: "Kategorie",
      hoursLabel: "Abrechnungsfenster (Stunden)",
      seedLabel: "Start-Liquidität (USDC, optional)",
      cancel: "Abbrechen",
      submit: "Erstellen",
      noWallet: "Zuerst Wallet verbinden",
      submittedTitle: "Markterstellung übermittelt",
      seededTitle: "Liquiditätsbereitstellung übermittelt",
      seededBody: "{{amount}} USDC bereitgestellt",
      liveTitle: "Markt ist live",
      failedTitle: "Markterstellung fehlgeschlagen",
    },
  },

  /**
   * Marketing namespace — social proof surfaces (leaderboard, trade ticker), the novice
   * prize pool and the hall spotlight.
   *
   * Honesty contract: the leaderboard cohort and the sample ticker are simulations.
   * No invented "real users", no fake wallet counts.
   */
  marketing: {
    board: {
      title: "Top-Prognostiker",
      badge: "simulierte Kohorte",
      season: "Beispielbuch · {{volume}} Tsd. Volumen",
      colPredictor: "Prognostiker",
      colTrades: "Trades",
      colHit: "Treffer",
      colPnl: "PnL (fiktiv)",
      footnote:
        "Gerankt aus dem Beispielbuch, nicht aus echten Konten: 0 Live-Wallets, {{fills}} On-Chain-Fills seit dem Deployment. Jede Zahl hier ist simulierte FAKE-USDC.",
    },
    ticker: {
      title: "Orderflow",
      sample: "Beispiel-Datenstrom",
      live: "live",
      hint: "Binance Spot · echte Abschlüsse",
    },
    spotlight: {
      eyebrow: "KI-Desk · Spotlight",
      title: "255 Märkte. Fünf Kategorien. Eine Kurve.",
      markets: "{{count}} Märkte",
      volume: "{{amount}} USDC Volumen",
      body:
        "Politik, Krypto, Sport, E-Sport und Zukunftstechnologie — bepreist vom selben Constant-Product-Market-Maker, der auf Base abrechnet.",
      cta: "Gesamtes Buch ansehen",
    },
    pool: {
      eyebrow: "Einsteiger-Pool · Saison 1",
      title: "Sie sind im Preispool",
      body:
        "Jeder neue Prognostiker tritt demselben 25,000-FAKE-USDC-Pool bei. Ihr Anteil wächst mit jeder Position — lokal abgerechnet, niemals echtes Geld.",
      share: "Ihr Anteil",
      joined: "{{count}} Prognostiker in dieser Saison beigetreten",
      cta: "Jetzt prognostizieren",
      footnote:
        "Simulierter Pool. Chips sind lokal, nicht auszahlbar und haben keinen Geldwert.",
    },
  },

  /** Market cards, debate wall, AI desk commentary, share sheet. */
  social: {
    card: {
      simPosition: "Simulierte Position",
      untitled: "Markt ohne Titel",
      settled: "Abgerechnet",
      yesChance: "YES-Chance",
      noChance: "NO-Chance",
      liquidity: "Liquidität {{amount}}",
      volume: "Volumen {{amount}}",
      position: "Ihre Position · YES {{yes}} / NO {{no}}",
      paperValue: "Paper-Wert {{amount}}",
      closesPrefix: "endet ",
      disputePrefix: "Widerspruch ",
      disputeNotice:
        "Widerspruchsfrist 1 Stunde — das Safe kann das Ergebnis überschreiben. Auszahlungen pausiert.",
      shareFallbackQuestion: "KI-Prognosemarkt",
      loading: "On-Chain-Märkte werden über Multicall3 geladen…",
      errorTitle: "On-Chain-Daten konnten nicht gelesen werden",
      emptyTitle: "In diesem Sektor noch keine On-Chain-Märkte",
      emptyHint:
        "Die Hermes-KI benötigt USDC in einer aufgeladenen Wallet, um Märkte zu erstellen und Liquidität zu stellen. Die ausgewählten Demo-Märkte unten durchlaufen den kompletten Orderflow bereits mit Paper-Chips.",
    },
    comments: {
      title: "Debattenwand · {{count}} Beiträge",
      localOnly: "In diesem Browser gespeichert",
      yesWins: "YES gewinnt",
      noWins: "NO gewinnt",
      neutral: "Neutral",
      neutralTally: "Neutral {{count}}",
      stanceWins: "{{side}} gewinnt",
      nickname: "Nickname (optional)",
      placeholder: "Beziehen Sie Stellung — warum gewinnt YES oder NO?",
      counter: "{{count}}/500 · Keine illegalen Inhalte",
      submit: "Posten",
      empty: "Noch keine Beiträge — seien Sie der Erste.",
      official: "Offizielle Frage",
      delete: "Löschen",
      secondsAgo: "vor {{n}}s",
      minutesAgo: "vor {{n}}min",
      hoursAgo: "vor {{n}}h",
      daysAgo: "vor {{n}}T",
    },
    ai: {
      desk: "Hermes-KI-Desk",
      tone: {
        bull: "Bullisch",
        bear: "Bärisch",
        warn: "Risiko",
        geek: "Quant",
        calm: "Neutral",
      },
      live: "Live von der KI",
      local: "Lokales Modell",
      updated: "aktualisiert {{time}}",
      basisFallback: "On-Chain-Pool-Tiefe und Nachrichtenlage",
      disclaimerBrain:
        "Von Regeln / der KI aus öffentlichen Daten verfasst. Keine Anlageberatung. Quelle: Hermes-KI-Zyklus.",
      disclaimerLocal:
        "Von Regeln / der KI aus öffentlichen Daten verfasst. Keine Anlageberatung. Quelle: Frontend-Regel-Engine, KI offline.",
    },
    share: {
      deepLink: "Deeplink",
      copied: "Kopiert",
      shareIn: "In Telegram teilen",
      shareSheet: "Telegram-Teilen öffnen",
      template: "Auf Aura handeln → #PredictionMarkets #Base #AI",
      label: "Teilen",
      tooltip: "Teilen-Karte für X rendern",
      generating: "Wird gerendert…",
      heading: "Teilen-Karte",
      geometry: "1200×630 · Einladungs-QR enthalten",
      close: "Schließen",
      alt: "Teilen-Karte",
      download: "PNG herunterladen",
      postOnX: "Auf X posten",
      copyText: "Post-Text kopieren",
      failed: "Card-Rendering fehlgeschlagen: {{err}}",
    },
  },

  /** Welcome airdrop modal: first-run paper credit. */
  airdrop: {
    eyebrow: "Airdrop · Paper-Trading",
    headline: "Willkommensbonus",
    body:
      "Keine Wallet, keine USDC nötig. 10,000 FAKE-USDC Paper-Chips wurden automatisch in dem Moment gutgeschrieben, in dem Sie eingetroffen sind.",
    chipsUnit: "FAKE-USDC · Paper-Chips",
    credited: "Gutgeschrieben · jederzeit zurücksetzbar",
    badges: {
      marketsValue: "12",
      markets: "ausgewählte Märkte",
      quotesValue: "CPMM",
      quotes: "Kurse",
      aiValue: "◈",
      ai: "KI-Einschätzungen",
    },
    ctaBalance: "Handel starten · Guthaben {{balance}} FAKE",
    finePrintPaper:
      "Paper-Modus. Nur Spielgeld, nichts berührt echte Vermögenswerte. Wechseln Sie oben rechts jederzeit zu Echtgeld.",
    finePrintReal:
      "Sie sind im Echtgeld-Modus. Ihre Paper-Chips bleiben hier und stehen bereit, sobald Sie zurückwechseln.",
  },

  /** Shared UI atoms: countdown, probability bar, loader, empty states, spinner. */
  ui: {
    countdown: {
      expired: "Abgelaufen",
    },
    loader: {
      connecting: "Verbindung zu Base Mainnet…",
    },
    wordmark: {
      subtitle: "KI-Prognosemärkte · Base",
    },
    toast: {
      explorerLink: "Auf Basescan ansehen →",
    },
    empty: {
      fallbackTitle: "Hier ist noch nichts",
    },
  },
  terminal: {
    locale: {
      label: "Sprache",
      hint: "Oberflächensprache",
      current: "Aktive Sprache",
      saved: "Spracheinstellung gespeichert",
    },
    hero: {
      eyebrow: "Globale Schlagzeilen",
      title: "Wo die Welt den morgigen Preis handelt",
      body: "Live-Wahrscheinlichkeiten zu Geopolitik, Notenbanken, Zukunftstechnik, E-Sport und Kultur.",
      previous: "Vorherige Meldung",
      next: "Nächste Meldung",
      pause: "Rotation anhalten",
      play: "Rotation fortsetzen",
      slide: "{{index}} / {{total}}",
      probability: "JA",
      move: "{{delta}} in der letzten Stunde",
      cta: "Markt öffnen",
      depth: "{{amount}} USDC Tiefe",
      settling: "Abrechnung in {{hours}} Std.",
    },
    whale: {
      title: "Whale-Flow",
      hint: "Tickets ab 25k $ · Binance Spot",
      sample: "Simuliertes Tape",
      live: "On-Chain-Tape",
      bought: "gekauft",
      sold: "verkauft",
      ago: "vor {{mins}} Min.",
      justNow: "gerade eben",
      note: "Echte Börsenabschlüsse, keine Fills dieses Buches.",
    },
    depth: {
      title: "Markttiefe",
      yes: "JA-Buch",
      no: "NEIN-Buch",
      price: "Mittelkurs",
      sweep: "Ausführung für {{amount}}",
      capacity: "Tiefe",
      unit: "USDC",
      levels: "{{count}} Stufen",
      axis: "Preis",
    },
    sync: {
      title: "Cloud-Sync",
      local: "Nur lokal",
      ready: "Bereit zum Sync",
      syncing: "Synchronisiere",
      synced: "Synchronisiert",
      error: "Sync fehlgeschlagen",
      connectWallet: "Wallet verbinden, um zu synchronisieren",
      body: "Papierguthaben, Positionen, Handelshistorie, Empfehlungsjournal und Debattenbeiträge folgen deiner Wallet geräteübergreifend. Die Nutzlast wird mit AES-GCM unter einem aus deiner Signatur abgeleiteten Schlüssel versiegelt, bevor sie den Browser verlässt.",
      lastSync: "Letzter Sync {{time}}",
      push: "Jetzt senden",
      pull: "Jetzt laden",
      device: "Dieses Gerät",
      cipher: "AES-GCM · Wallet-abgeleiteter Schlüssel",
      provider: "Kanal",
    },
  },

  affiliate: {
    eyebrow: "Partnerprogramm",
    title: "20 % der Protokollgebühr verdienen",
    body: "Teile deinen Link. Jeder zugeordnete Trade zahlt dir 20 % der 1,5 % Handelsgebühr — direkt aus dem Protokollanteil.",
    close: "Schließen",
    closeAria: "Partnerfenster schließen",
    inviteLabel: "Dein Einladungslink",
    copy: "Link kopieren",
    copyTg: "Telegram-Link kopieren",
    copied: "Kopiert",
    share: "Teilen",
    shareText: "Handle KI-geschriebene Prognosemärkte auf Base — 255 Märkte live",
    connectHint: "Verbinde eine Wallet, um deinen persönlichen Link zu erzeugen — bis dahin bleibt die Adresse leer.",
    invites: "Geöffnete Einladungen",
    volume: "Zugeordnetes Volumen",
    rebate: "Gesch. Rabatt (USDC)",
    onchain: "On-Chain-Saldo",
    pool: "Pool {{amount}} USDC",
    ledgerMissing: "Ledger nicht deployed",
    claim: "Abholen",
    claiming: "Wird abgeholt…",
    claimed: "Rabatt abgeholt — USDC ist in deiner Wallet.",
    claimFailed: "Abholen fehlgeschlagen.",
    poolTopping: "Der Rabatt-Pool wird aufgefüllt — die Auszahlung erfolgt, sobald er deinen Saldo deckt.",
    arrived: "Du bist über {{addr}} gekommen. Diese Adresse wird als Calldata-Metadatum mit deinen echten Orders übermittelt.",
    noReferrer: "In diesem Browser wurde noch kein Empfehler erfasst.",
    noteReady: "Einladungen und Volumen oben sind lokal auf diesem Gerät; der On-Chain-Saldo wird vom ReferralLedger abgerechnet.",
    noteLocal: "Einladungen und Volumen oben sind lokal auf diesem Gerät. Die On-Chain-Auszahlung startet, sobald ReferralLedger deployed und VITE_REFERRAL_LEDGER gesetzt ist.",
  },

  live: {
    badge: "LIVE",
    title: "Live-Märkte",
    subtitle: "Echte Spotpreise, Schwellen aus dem aktuellen Kurs und ein fixer UTC-Schluss",
    source: "CoinGecko Spot",
    updated: "Aktualisiert {{time}}",
    question: "Schließt {{asset}} bis {{date}} über {{price}}?",
    criteria: "CoinGecko {{asset}}/USD Tagesschluss um 00:00 UTC am {{date}}.",
    spot: "Spot {{price}}",
    distance: "{{pct}} % bis zum Strike",
    trade: "Handeln",
    unavailable: "Live-Kurse nicht verfügbar — der Katalog unten ist davon unberührt.",
  },
} satisfies Messages;
