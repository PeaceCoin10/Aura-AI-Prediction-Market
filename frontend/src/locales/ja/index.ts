import type { Messages } from "../en";

/** Japanese (ja-JP) message tree. Mirrors en 1:1. */
export const ja = {
  shell: {
    brand: {
      name: "Aura",
      wordmark: "AURA",
      tagline: "エージェント型 予測マーケット",
      descriptor: "AIが執筆するマーケット · CPMMプライシング · Baseメインネット",
    },
    tabs: {
      feed: "マーケット",
      portfolio: "ポートフォリオ",
      activity: "オンチェーン",
      feedShort: "マーケット",
      portfolioShort: "資産",
      activityShort: "イベント",
    },
    nav: {
      hot: "急上昇",
      crypto: "暗号資産",
      news: "ニュース",
      sports: "スポーツ",
      esports: "eスポーツ",
      tech: "テック",
      other: "その他",
    },
    navHints: {
      hot: "全カテゴリをアクティビティ順に表示",
      crypto: "主要銘柄、DeFi、オンチェーンの資金フロー",
      news: "世界のニュース、地政学、マクロ経済",
      sports: "NBA · NFL · プレミアリーグ · UCL",
      esports: "LoL · CS2 · VCT",
      tech: "AI、半導体、規制",
    },
    mode: {
      real: "実弾",
      paper: "ペーパー",
      realTitle: "実弾モード — ウォレットを接続し、Base上のUSDCで取引します。",
      paperTitle: "ペーパーモード — 10,000 FAKE-USDCを無料配布。ウォレット不要、リスクなし。",
      switchedPaper: "ペーパーモードを有効にしました",
      switchedPaperBody:
        "10,000 FAKE-USDCを付与しました。オフチェーンでリスクゼロ——一連の流れを練習できます。",
      switchedReal: "実弾モードを有効にしました",
      switchedRealBody:
        "ウォレットを接続してBase上の実際のUSDCで取引します。ポジションサイズには十分ご注意ください。",
    },
    sound: {
      on: "サウンドON — クリックでミュート",
      off: "ミュート中 — クリックで解除",
    },
    actions: {
      connect: "ウォレット接続",
      disconnect: "切断",
      switchChain: "Baseに切り替え",
      switchFailed: "チェーンの切り替えに失敗しました",
      security: "セキュリティ",
      securityTitle: "セキュリティマトリクス：Slither、不変条件、異議申立期間",
      docs: "ドキュメント",
      docsTitle: "ドキュメント：はじめに、AIアーキテクチャ、SDK",
      refresh: "更新",
      refreshing: "更新中…",
      close: "閉じる",
      search: "マーケット、カテゴリ、チームを検索…",
      newMarket: "新規マーケット",
      claimChips: "10,000チップを受け取る",
      resetChips: "チップをリセット",
      resetChipsTitle: "ペーパー残高を10,000に戻し、ペーパーポジションを消去します",
      connectToView: "ウォレットを接続してポジションを表示",
    },
    status: {
      rpc: "Base RPC",
      rpcDown: "到達不可",
      brain: "Hermesブレイン",
      heartbeat: "ハートビート稼働中",
      lastCycle: "最終サイクル {{min}}分前",
      idle: "待機中 — マーケットの供給にはウォレットへの入金が必要です",
      security: "セキュリティマトリクス",
      docs: "ドキュメントポータル",
    },
    locale: {
      label: "言語",
      active: "JA",
    },
    footer: {
      engine: "CentralPredictionEngine",
      chain: "Base · チェーンID 8453",
      fees: "取引手数料 1.5% / 精算手数料 0.5%",
      dispute: "異議申立期間 1時間",
      rights: "オープンソース · MIT",
    },
    toasts: {
      copied: "クリップボードにコピーしました",
      copyFailed: "コピーに失敗しました — テキストを手動で選択してください",
    },
  },

  hall: {
    heroTitleA: "AI予測マーケット",
    heroTitleB: "自らオーダーブックを書き上げるブレイン",
    heroBody:
      "Hermesは暗号資産・ニュース・スポーツ・eスポーツのライブフィードから、5分ごとにマーケットを起案します。価格はBase上の定数積マーケットメイカーが決定し、更新ごとにMulticall3の読み取り1回、間隔は15秒です。",
    statsPaper: {
      featured: "注目マーケット",
      cadence: "ティック間隔",
      cadenceValue: "7秒",
      volume: "シミュレート出来高",
      chain: "オンチェーンマーケット",
    },
    statsReal: {
      chain: "オンチェーンマーケット",
      active: "取引中",
      liquidity: "プール流動性",
      featured: "注目マーケット",
    },
    paperBar: {
      label: "ペーパー取引",
      balance: "残高",
      hint: "ウォレット不要 — 注目マーケット12件、リアルなシミュレートティック、AIの見解、ディベートウォールがすべて稼働中です。",
      hintCount:
        "ウォレット不要 — 注目マーケット{{count}}件、リアルなシミュレートティック、AIの見解、ディベートウォールがすべて稼働中です。",
    },
    sections: {
      featuredTitle: "注目マーケット",
      featuredBadge: "オフチェーン · 取引可能",
      featuredNote: "7秒ごとのシミュレートティック · 気配値は実際のCPMM計算式を使用",
      chainTitle: "オンチェーンで稼働中のマーケット",
      chainNote:
        "CentralPredictionEngineはデプロイ済みで一時停止も解除されていますが、まだマーケットは供給されていません。Hermesブレインがマーケットを作成・供給するには、ウォレットにUSDCが必要です。",
      chainEmptyTitle: "オンチェーンマーケットはまだありません",
      chainEmptyBody:
        "以下はすべて注目マーケットです。同じCPMM計算式と同じ取引フローを使い、精算だけをローカルで行うため、数秒でゼロからポジションを持てます。",
      demoEmptyTitle: "このカテゴリはまだ空です",
      demoEmptyHint: "急上昇に戻るか、別のカテゴリを選んでください。",
      refreshFailed: "更新に失敗しました — 最後に取得できたスナップショットを表示しています：",
    },
    portfolio: {
      title: "ポートフォリオ",
      subtitle:
        "ポジションはエンジン内部のyesOf / noOf台帳（ERC-1155のセマンティクス）です。redeem()で引き出せます。",
    },
    connect: {
      title: "ウォレットを接続",
      body: "EIP-6963ディスカバリにより、MetaMask、Coinbase、Rabby、あらゆるEOAといったインジェクト型ウォレットをすべて検出します。接続するとBaseメインネット（8453）への切り替えを求められます。",
      empty:
        "ウォレット拡張機能が見つかりません。MetaMaskまたはCoinbase Walletをインストールして再読み込みしてください。上の注目マーケットをペーパーチップで取引することもできます。",
      connecting: "接続中…",
      failed: "接続に失敗しました",
    },
    paused:
      "プロトコルは一時停止中です。新規取引は拒否されます。処理されるのは精算と異議申立後の引き出しのみです。",
  },

  /**
   * `content` namespace — market copy and data-layer strings: demo questions and their
   * resolution criteria, seeded debate threads, insight commentary, on-chain event labels,
   * lifecycle phases and the error strings surfaced by the paper engine and wallet layer.
   * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  content: {
    demoMarkets: {
      "demo-btc-88k": {
        question: "BTCは24時間以内に88,000ドルを突破しますか？",
        criteria:
          "精算時のBTC/USDスポット価格が88,000ドル以上ならYES（CoinGeckoを優先、Binanceを代替）。それ以外はNO。",
      },
      "demo-eth-etf": {
        question: "今週、現物ETH ETFの1日あたり純流入額が5億ドルを超える日はありますか？",
        criteria:
          "Farside / SoSoValueの公式フローデータで、純流入が5億ドルを超える日が1日でもあればYES。",
      },
      "demo-defi-tvl": {
        question: "DeFiの総TVLは48時間以内に1,200億ドルを回復しますか？",
        criteria: "精算時の全チェーンTVLスナップショットがDefiLlamaで1,200億ドル以上ならYES。",
      },
      "demo-fed-cut": {
        question: "次回のFOMC声明でFRBが利下げに明確に言及しますか？",
        criteria:
          "連邦準備制度のウェブサイトで公開されたFOMC声明に利下げへの言及が含まれていればYES。それ以外はNO。",
      },
      "demo-ceasefire": {
        question: "今週、主要メディア2社以上が停戦合意を確認しますか？",
        criteria:
          "精算前にReuters、AP、BBCのうち2社以上が独自に停戦を報じればYES。1社の通信記事が転載されただけでは2社目とはみなしません。",
      },
      "demo-ai-act": {
        question: "EU AI法の施行規則は今月中に発効しますか？",
        criteria:
          "官報（OJ）に本文が掲載された場合のみYES。OJ掲載のない欧州委員会の承認はNOとなります。",
      },
      "demo-nba-celtics": {
        question: "今夜のNBA、ボストン・セルティックスはブルックリン・ネッツに勝ちますか？",
        criteria:
          "ESPNの公式最終スコア（延長含む）で精算：セルティックス勝利→YES、敗戦または同点→NO。24時間を超える順延→INVALID（無効）として返金。",
      },
      "demo-epl-derby": {
        question: "今節のプレミアリーグで、アーセナルはチェルシーに勝ちますか？",
        criteria:
          "プレミアリーグの公式最終スコア（アディショナルタイム含む）で精算：アーセナル勝利→YES、引き分けまたは敗戦→NO。",
      },
      "demo-nfl-chiefs": {
        question: "カンザスシティ・チーフスは敵地で勝利しますか？",
        criteria: "NFLの公式最終スコアで精算：チーフス勝利→YES、同点または敗戦→NO。",
      },
      "demo-lol-t1": {
        question: "Worldsのノックアウトステージで、T1はMovistar KOIに勝ちますか？",
        criteria:
          "LoL Esportsの公式結果（gameWins）で精算：T1がシリーズを制すればYES、それ以外はNO。",
      },
      "demo-cs2-major": {
        question: "CS2 Majorのグループステージで、欧州地域は試合の60%超に勝利しますか？",
        criteria:
          "HLTVの公式イベント統計に基づき、精算時の欧州の勝率が60%超ならYES、それ以外はNO。",
      },
      "demo-valorant": {
        question: "センティネルズは次のVCTの試合を2:0で勝ちますか？",
        criteria: "VCTの公式結果に基づき、スコアがちょうど2:0ならYES、それ以外のスコアならNO。",
      },
    },

    seedComments: {
      "demo-btc-88k": [
        {
          author: "0xWhale",
          stance: "YES",
          text: "ETFへの資金流入が止まりません。88kは時間の問題で、24時間あれば十分です。",
        },
        {
          author: "Satoshi_Cat",
          stance: "NO",
          text: "86kには分厚い清算の壁があります。抜けられません。",
        },
      ],
      "demo-eth-etf": [
        {
          author: "defi_researcher",
          stance: "YES",
          text: "ステーキングETFが通れば、1日5億ドルなんて誤差です。",
        },
      ],
      "demo-fed-cut": [
        {
          author: "MacroHound",
          stance: "NO",
          text: "ドットプロットはまだタカ派。声明に「利下げ」という言葉は出ません。",
        },
        {
          author: "Bond_Trader",
          stance: "YES",
          text: "インフレ指標は反転しました。ハト派寄りの文言になる確率はすでに40%です。",
        },
      ],
      "demo-nba-celtics": [
        {
          author: "courtside_vet",
          stance: "YES",
          text: "ホームで、しかも相手は連戦明け。接戦にはなりません。",
        },
      ],
      "demo-lol-t1": [
        {
          author: "RiftAnalyst",
          stance: "YES",
          text: "T1のドラフト準備はより深い。BO5の経験差は本物です。",
        },
        {
          author: "KOI_faithful",
          stance: "NO",
          text: "このパッチはKOIの序盤テンポに向いています。波乱がありますよ。",
        },
      ],
    },

    insights: {
      flavor: {
        crypto: "オンチェーンの資金フロー",
        news: "ニュース速報",
        tech: "テックの物語",
        sports: "スポーツブック",
        esports: "eスポーツのメタ",
        fallback: "マーケット",
      },
      crowded:
        "YESはすでに{{prob}}%——ロング側は極端に混雑しています。ここで買うとオッズはあなたに不利で、大口の売り1本で二桁の下落を招きかねません。",
      edge:
        "ロングが{{prob}}%でわずかに優位ですが、{{flavor}}はまだ決定的なシグナルを出していません。一撃で入らず分割して建ててください。",
      neutral:
        "確率は{{prob}}%で中立帯のど真ん中に張り付いています。双方が新しい材料を待っている状況です。流動性提供者が最も安心できる水準で、テイカーはどちらに動いても振り回されます。",
      fade:
        "ショートがわずかに優勢（YES {{prob}}%）。安いもののカタリストが必要な構造で、小さなリバーサルベットだけが正しいペイオフになります。",
      priced:
        "YESは{{prob}}%まで低下——市場はこの結果をほぼ完全に織り込みました。{{flavor}}にブラックスワン級の反転がない限り、残存価値はわずかです。",
      thinPool:
        " プールの深さはわずか{{depth}} USDCのため、100 USDCで価格が動きます。インパクトコストに注意してください。",
      heavyVolume:
        " 出来高（{{vol}} USDC）はすでにプール深度の{{multiple}}倍——回転は非常に活発です。",
      closingSoon:
        " 精算まで1時間を切りました。異議申立期間が始まると引き出しはロックされます。",
      finalHours:
        " 精算まで{{hours}}時間。終盤は最もボラティリティが高くなる傾向があります。",
      basis: "確率 {{prob}}% · 深度 {{depth}} USDC · 出来高 {{vol}} USDC",
    },

    eventLabels: {
      MarketCreated: "マーケット作成",
      MarketCategoryUpdated: "カテゴリ更新",
      LiquiditySeeded: "流動性供給",
      SharesBought: "買い約定",
      SharesSold: "売り約定",
      MarketResolved: "マーケット精算",
      DisputeWindowOpened: "異議申立期間の開始",
      ResolutionOverridden: "精算結果の上書き",
      ResolutionFinalized: "精算確定",
      Redeemed: "償還支払い",
      ResidualSwept: "残余の回収",
      FeeVaultUpdated: "手数料保管庫の更新",
      TreasuryUpdated: "トレジャリーの更新",
      CreatorUpdated: "作成者権限の変更",
      OracleUpdated: "オラクル権限の変更",
      Paused: "プロトコル一時停止",
      Unpaused: "プロトコル再開",
      AdminTransferStarted: "管理者移譲の開始",
      AdminTransferred: "管理者移譲完了",
    },

    /** Feed / toast bodies. `{{var}}` is substituted from decoded event args. */
    eventFeed: {
      createdTitle: "{{label}}：{{question}}",
      createdBody: "カテゴリ {{category}} · {{when}}に精算",
      liquidityBody: "{{amount}} USDCをプールに供給",
      tradeTitle: "{{label}} · {{outcome}}",
      buyBody: "{{amount}} USDCを支払い → {{shares}}株を受領（手数料 {{fee}}）",
      sellBody: "{{shares}}株を売却 → {{amount}} USDCを受領",
      resolvedTitle: "{{label}}：{{outcome}}",
      resolvedBody: "異議申立期間 1時間 — Safeが上書き可能",
      resolvedBodyEmergency: "緊急返金ルート",
      disputeBody: "{{when}}まで異議申立期間中。期間中は償還がロックされます",
      overrideTitle: "{{label}}：{{from}} → {{to}}",
      overrideBody: "結果を{{count}}回上書き",
      redeemedBody: "支払い {{payout}} USDC（YES {{yes}} / NO {{no}} を焼却）",
      pausedBody: "取引と償還を停止中（緊急引き出し期間を除く）",
    },

    outcomes: {
      yesWins: "YESの勝ち",
      noWins: "NOの勝ち",
      invalid: "無効（1株あたり0.5を支払い）",
    },

    phase: {
      trading: "取引中",
      awaiting: "精算待ち",
      disputing: "異議申立期間中",
      final: "確定",
      closed: "終了",
      empty: "見つかりません",
    },

    paper: {
      amountPositive: "金額は0より大きい必要があります",
      insufficientBalance:
        "ペーパー残高が不足しています — 先に10,000 FAKE-USDCを受け取ってください",
      noShares: "この金額では株を購入できません — プールが薄いか金額が小さすぎます",
      noPosition: "このマーケットにペーパーポジションはありません",
      exceedsPosition: "売却数量がポジションを超えています",
      depthTooThin: "現在の深度ではこの売却を吸収できません",
    },

    wallet: {
      noProvider:
        "ウォレット拡張機能が見つかりません — MetaMaskまたはCoinbase Walletをインストールしてください",
      noAccounts: "ウォレットからアカウントが返されませんでした",
      notConnected: "ウォレット未接続",
      fallbackName: "ブラウザウォレット",
      hookOutsideProvider: "useWalletは<WalletProvider>内で使用する必要があります",
    },

    mode: {
      hookOutsideProvider: "useModeは<ModeProvider>内で使用する必要があります",
    },

    format: {
      expired: "期限切れ",
      unknownError: "不明なエラー",
      dayUnit: "日",
    },

    slippage: {
      conservative: "保守的",
      default: "標準",
      aggressive: "積極的",
    },

    poster: {
      tagline: "エージェント型DeFi · AI予測マーケット",
      modePaper: "ペーパー",
      modeReal: "実弾",
      sideNeutral: "様子見",
      sideBet: "{{side}}にベット",
      probLabel: "現在のYES確率",
      returnLabel: "想定リターン",
      scanQr: "スキャンしてマーケットを開く",
      footer:
        "Baseメインネット · コントラクト検証済み · 異議申立期間1時間 · 取引手数料1.5%",
      canvasUnavailable: "キャンバスを利用できません",
      tweetLeadNeutral: "様子見中",
      tweetLeadBet: "{{side}}にベット中",
      tweet:
        "{{lead}}「{{question}}」| YES {{prob}}%{{potential}} #AIPredictionMarkets #Base #Aura",
      tweetPotential: "、想定リターン {{ret}}",
    },
  },

  /**
   * `security` namespace — first-run risk disclosure, security matrix drawer and docs portal.
   * A compliance surface: wording stays literal and every figure is a real repository result.
   * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  security: {
    common: {
      close: "閉じる",
    },

    risk: {
      title: "リスク開示と利用規約",
      bulletProtocol:
        "Auraは分散型の予測マーケットプロトコルです。投資助言者ではなく、ここに記載された内容は投資助言ではありません。",
      bulletPrice:
        "株価はAMMのカーブによって決まり、ゼロになる可能性があります。失っても構わないUSDCのみを投じてください。",
      bulletDispute:
        "精算には1時間の異議申立期間があります。期間中は引き出しが停止され、その間にSafeマルチシグが結果を覆すことができます。",
      bulletPaper:
        "ペーパーモードはローカルの仮想チップで動作します。実際の資産は関与せず、チップを換金することはできません。",
      bulletAudit:
        "コントラクトはオープンソースでBaseメインネット上に検証済みですが、いかなる監査もリスクゼロを保証するものではありません。",
      consent:
        "続行することで、本規約を読み同意したこと、およびお住まいの法域がこの種の商品への参加を認めていることを確認します。",
      ack: "リスクを理解しました — マーケットへ",
    },

    drawer: {
      title: "セキュリティマトリクス",
      slither: {
        title: "静的解析 · Slither",
        high: "高",
        medium: "中",
        low: "低",
      },
      tests: {
        title: "テストマトリクス",
        forgeLead: "forge test — ",
        forgeTail: " 件のテストが成功（ユニット＋不変条件）",
        invariantLead: "不変条件テスト：",
        invariantRunsDepth: " 回 × 深さ ",
        invariantCallsLead: "、",
        invariantTail:
          " のハンドラ呼び出しを実行（セレクタ8個あたり約12,800回）、リバート0件、不変条件の破綻0件",
        coverage:
          "SDK：オフライン70/70ケース · フロントエンド：ライブチェーンe2e 11/11＋UI e2e 55/55",
      },
      economics: {
        title: "経済・ガバナンス制御",
        feeLead: "手数料：",
        feeTail: " — 全額がProtocolFeeVaultに送られ、引き出しにはSafeの署名が必要です",
        disputeLead: "異議申立期間：",
        disputeTail: "。マーケット精算の瞬間に開始し、期間中は引き出しが停止されたままです",
        overrideLead: "上書き：",
        emergencyLead: "緊急時：",
        emergencyWindow: "7日",
        emergencyMid: " を過ぎても精算されない場合、誰でも ",
        emergencyTail: " を呼び出して全額返金を受けられます",
      },
      verified: {
        title: "検証済みコントラクト（Baseメインネット）",
        badge: "✓ 検証済み",
      },
    },

    docs: {
      title: "ドキュメントポータル",
      tabs: {
        start: "はじめに",
        brain: "Hermes AIアーキテクチャ",
        sdk: "SDK連携",
      },

      start: {
        headingPaper: "ウォレットなしで3秒でポジションを持つ",
        paperSteps: [
          "右上のトグルをペーパーに切り替え → 10,000チップを受け取ります。",
          "ホールで任意のマーケットを選び、YESまたはNOを購入します — 株数、平均価格、プライスインパクトはリアルタイムで算出されます。",
          "ポジションパネルは含み損益（PnL）をリアルタイムで追跡し、売却するとそのまま残高に戻ります。",
        ],
        headingReal: "実弾取引",
        realSteps: [
          "実弾に切り替え → ウォレットを接続します（Base、チェーンID 8453に切り替わります）。",
          "マーケットを選び → USDCの金額を入力 → 最初の取引では承認が必要ですが、パネルがその処理を行います。",
          "トーストにトランザクションハッシュが表示されるので、Basescanで開けます。",
          "マーケットが精算されると1時間の異議申立期間に入り、期間が終わると償還が可能になります。",
        ],
        headingFees: "手数料と精算",
        feesBody:
          "取引で1.5%、精算の支払いで0.5%が差し引かれます。価格 = NOリザーブ / 総リザーブで、1回の取引はプール深度の5%で厳格に上限が設けられます。",
      },

      brain: {
        headingEngines: "3つのエンジン、1つのループ",
        creator: "クリエイター",
        creatorBody:
          "：複数ベニューからの取り込み（CoinGecko／Binance、RSSニュース、ESPNスコアボード、LoL Esports）→ YES/NOの二値質問 → マーケットメイキング用流動性を伴うマーケット作成",
        oracle: "オラクル",
        oracleBody:
          "：価格マーケットはヒゲ足に耐えるため3×30秒のマルチサンプル読み取りを行います。スポーツとeスポーツは公式結果のみで精算。ニュースマーケットは自動精算されず、Safeまたは手動呼び出しを待ちます",
        marketing: "マーケティング",
        marketingBody:
          "：新規マーケットごとにテンプレートエンジンがTwitter / Telegram向けの文面を生成（任意でLLM処理を追加）",
        headingConstraints: "質問文作成における厳格な制約",
        constraintsBody:
          "二値の枠組み（〜するか／しないか）、精算は30分後から8日後まで、そして客観的な解決基準。これ以外は破棄されます。",
        headingCommentary: "コメンタリー",
        commentaryLead:
          "ブレインは各サイクルで、実際のマーケットについての解説を次に書き込みます：",
        commentaryTail:
          "。フロントエンドは60秒ごとにポーリングします。ブレインがオフラインのときはフロントエンドのルールエンジンに切り替わり、出力に「ローカル推論」と表示されます。",
      },

      sdk: {
        headingInstall: "インストールと接続",
        headingRead: "マーケットを読む（Multicall3を1回）",
        headingOrder: "注文を出す",
        footnote:
          "オフライン見積もりはpreviewBuyOffline / previewSellOfflineとしてSDKに同梱され、オンチェーンのpreviewBuyとwei単位で一致します。decodeLogsは生のイベントを構造化された通知に変換します。",
      },
    },
  },

  /**
   * `trade` namespace — on-chain market detail and the real trading panel.
   * Crypto-native, terse venue vocabulary; fees and windows are contract facts, never rounded.
   * Templates use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  trade: {
    common: {
      close: "閉じる",
    },

    market: {
      onChainChip: "オンチェーンマーケット",
      settlesPrefix: "精算 ",
      inPrefix: "あと ",
      untitled: "無題のマーケット",
      shareFallbackQuestion: "AI予測マーケット",
      dataTitle: "マーケットデータ（オンチェーンから直接取得）",
      yesProb: "YES確率",
      noProb: "NO確率",
      yesReserve: "YESリザーブ",
      noReserve: "NOリザーブ",
      cash: "プール現金",
      owed: "負債総額",
      volume: "累計出来高",
      tradable: "取引可能",
      yes: "YES",
      no: "NO",
      status: "精算ステータス",
      statusFinalized: "確定",
      statusDispute: "異議申立中",
      statusUnresolved: "未精算",
      outcome: "結果",
      rulesTitle: "ルール",
      rulePricing:
        "価格 = NOリザーブ / 総リザーブ。取引はCPMMを通り、1回の注文はプール深度の5%で厳格に上限が設けられます。",
      ruleFees:
        "取引額から1.5%、精算の支払いから0.5%の手数料が差し引かれます。",
      ruleDispute:
        "精算が始まると1時間の異議申立期間に入ります。Safe（管理者）は結果を覆すことができ、その間ずっと引き出しは停止されます。",
      ruleEmergency:
        "精算時刻から7日を過ぎても未精算の場合、誰でもemergencyRefundを呼び出して全額返金を受けられます。",
    },

    panel: {
      poolDepth: "プール深度",
      disputeLeft: "異議申立終了まで",
      settlesIn: "精算まで",
      finalized: "確定",
      awaitingFinalize: "確定待ち",

      disputeTitle:
        "1時間の異議申立期間内です。Safeはまだ結果を覆すことができ、引き出しは停止されています。",
      disputeBodyLead: "異議申立の終了まで ",
      disputeBodyMid: "、その後は自動的に確定します — 誰でも ",
      disputeBodyTail: " を呼び出して確定イベントを書き込めます。",

      position: "あなたのポジション",
      redeemTitleClosed: "異議申立期間中は引き出しできません",
      redeemDispute: "異議申立中は引き出し停止",
      redeemReady: "賞金を償還",
      redeemEmpty: "償還可能なポジションなし",
      redeemNote:
        "精算手数料0.5%。INVALIDのマーケットはYES 1株・NO 1株あたり0.5 USDCを支払います。プロトコルが一時停止中の場合、強制引き出しは精算時刻の7日後に可能になります。",

      buyShares: "株を買う",
      sellShares: "株を売る",
      amountInLabel: "投入USDC",
      sellLabel: "売却する株数",
      sellable: "（最大 {{amount}}）",
      unitUsdc: "USDC",
      unitShares: "株",
      max: "最大",

      slippage: "スリッページ",
      capHint: "1回あたりの上限 ≈ {{amount}} USDC（深度の5%）",

      quoteReceive: "受取額",
      quoteReturn: "返戻額",
      quoteChain: "· オンチェーン見積もり",
      quoteOffline: "· オフライン推定",
      unitSharesSuffix: " 株",
      avgFill: "平均約定価格",
      pricePerShare: "USDC/株",
      priceImpact: "プライスインパクト",
      impactCap: " / 上限5%",
      tradingFee: "取引手数料",
      feeOnChain: "（オンチェーンで差し引き）",
      protectedPrice: "保護価格",
      protectedPriceValue: "{{amount}}（-{{slip}}）",
      impactWarnLead: "インパクトが上限の80%に達しています（SDK警告 ",
      impactWarnMid: "）。これより大きな注文は次により拒否されます：",
      impactWarnTail: " — 数量を減らすか注文を分割してください。",

      submitSettled: "マーケット精算済み",
      submitClosed: "取引終了",
      buy: "{{side}}を買う",
      sell: "{{side}}を売る",
      connectToTrade: "ウォレットを接続して取引",

      confirmTitle: "プライスインパクトが上限に接近",
      confirmBodyLead: "SDKの返却値 ",
      confirmBodyMid: " — この注文はプール深度の ",
      confirmBodyTail:
        "% を消費します（コントラクト上限5%）。約定は大幅に不利になり、実際の資金が動きます。",
      confirmReduce: "数量を減らす",
      confirmProceed: "それでも実行",

      footerUsdc: "USDC",
      footerEngine: "エンジン",
      footerNote: "オンチェーン精算、取り消し不可",
    },

    toasts: {
      allowanceChecking: "USDCのアローワンスを確認中",
      allowanceBody: "権限付与先 = CentralPredictionEngine",
      submitted: "トランザクションを送信しました。確認を待っています…",
      reverted: "トランザクションがリバートされました（ステータス：reverted）",
      confirmedEvent: "オンチェーンで確認済み：{{event}}",
      confirmed: "オンチェーンで確認済み",
      tradeFailed: "取引に失敗しました",
      connectFirst: "先にウォレットを接続してください",
      amountRequired: "金額を入力してください",
      redeemSubmitted: "償還を送信しました",
      redeemConfirmed: "償還が確認されました",
      redeemFailed: "償還に失敗しました",
    },
  },

  paper: {
    card: {
      held: "保有中",
      yesProbability: "YES確率",
      noProbability: "NO確率",
      tickTitle: "模擬オーダーブックは7秒ごとに更新",
      depth: "深度 {{amount}} USDC",
      settlePrefix: "精算 ",
      expired: "期限切れ",
      volume: "出来高 {{amount}} USDC",
      debate: "💬 ディベート {{count}}",
      aiTag: "◈ AI",
      paperValue: "ペーパー評価額 {{amount}} FAKE",
      sample: "サンプル",
      tickNote: "シミュレートティック · 7秒間隔 · オフチェーン",
      byAuthor: "— {{author}}",
    },
    detail: {
      offchainBadge: "サンプルマーケット · オフチェーン",
      settledAt: "{{time}}に精算",
      remainingPrefix: "あと ",
      close: "閉じる",
      bookTitle: "マーケットデータ",
      yesProbability: "YES確率",
      noProbability: "NO確率",
      yesReserve: "YESリザーブ",
      noReserve: "NOリザーブ",
      volume: "累計出来高",
      source: "データソース",
      mathNote:
        "確率はCPMMが示す価格です。フロントエンドは7秒ごとにオーダーブックをわずかに動かし、シミュレートであることを明示しています。",
      criteriaTitle: "解決基準",
    },
    panel: {
      badge: "ペーパーモード",
      balance: "残高 {{amount}} FAKE-USDC",
      claim: "10,000チップを受け取る",
      reset: "リセット",
      resetTitle: "ペーパーアカウントをリセット",
      resetBody: "チップを10,000 FAKE-USDCに戻しました",
      buyYes: "YES · {{prob}}",
      buyNo: "NO · {{prob}}",
      amountLabel: "金額（FAKE-USDC）",
      amountPlaceholder: "0.00",
      max: "最大",
      slippage: "スリッページ",
      estShares: "推定株数",
      avgPrice: "平均価格",
      marginalPrice: "限界価格",
      minReceived: "最低受取額（スリッページ保護）",
      impact: "インパクト",
      impactWarning:
        "⚠ 警告：impact_near_limit — インパクト {{impact}}、コントラクト上限5%に接近しています。注文を分割した方が安く済みます。",
      buy: "{{side}}を買う",
      sell: "{{side}}を売る（{{shares}}）",
      insufficientChips: "チップが不足しています（残高 {{amount}}）。先に受け取るかリセットしてください。",
      boardTitle: "ペーパーポジション · PnL",
      boardEmpty: "ペーパーポジションはまだありません — 次の約定がここに表示されます。",
      yesShares: "YES株",
      noShares: "NO株",
      invested: "投入総額",
      markValue: "評価額（現金化ベース）",
      disclaimer:
        "ペーパーモード：実際のCPMM計算式とローカルのチップ。オフチェーン、引き出し不可、実資産は一切関与しません。",
      errorTitleBuy: "ペーパー注文に失敗しました",
      errorTitleSell: "ペーパー売却に失敗しました",
      toastBuyTitle: "ペーパー買い {{side}} が約定",
      toastBuyBody:
        "{{amount}} FAKE-USDC → {{shares}}株 · 平均 ${{price}} · オフチェーン、コストなし",
      toastSellTitle: "ペーパー売り {{side}} が約定",
      toastSellBody: "{{shares}}株 → {{proceeds}} FAKE-USDCを残高に戻しました",
    },
    account: {
      title: "ペーパーアカウント",
      badge: "ペーパー取引",
      summary: "残高 {{balance}} FAKE-USDC · ポジション評価額 {{value}}",
      unrealized: "含み損益",
      claim: "10,000チップを受け取る",
      reset: "ペーパーアカウントをリセット",
      empty:
        "ペーパーポジションはまだありません。ホールのいずれかのマーケットで注文してください — 評価額と損益がここに流れ込み、すべてローカルで決済されコストはかかりません。",
      rowMeta: "YES {{yes}} / NO {{no}} · 投入 {{spent}} · 評価額 {{value}}",
      footnote:
        "ペーパーモードは実際のCPMMカーブをローカルで決済します。チップは引き出し不可・譲渡不可で、実際のUSDCを扱うのは実弾モードのみです。",
    },
  },

  portfolio: {
    positions: {
      title: "ポジション",
      connectTitle: "ウォレットを接続してポジションを表示",
      connectHint:
        "ポジションはエンジンのオンチェーンERC-1155台帳（yesOf / noOf）に存在します。ローカルには何もキャッシュされません。",
      usdcBalance: "USDC残高",
      unsettled: "未精算（株数）",
      sharesUnit: "株",
      redeemable: "償還可能なマーケット",
      marketsUnit: "件",
      disputingUnit: "· 異議申立中 {{count}}件",
      disputeTitle: "{{count}}件のマーケットが1時間の異議申立期間内にあります",
      disputeTitlePlural: "{{count}}件のマーケットが1時間の異議申立期間内にあります",
      disputeBody:
        "1時間の異議申立期間中はSafeがまだ結果を覆せるため、引き出しはロックされています。カウントダウンが終了するか、誰かが次を呼び出すと償還が可能になります：",
      readingShares: "sharesOfを読み込み中…",
      emptyTitle: "ポジションはまだありません",
      emptyHint:
        "ホールでマーケットを選んでYES / NOを購入してください — 約定は即座にオンチェーンへ反映されます。",
      groupRedeemable: "償還可能",
      groupDisputing: "異議申立中",
      groupOpen: "オープン",
      untitled: "（無題のマーケット）",
      yesPrice: "YES {{price}}",
      settles: "{{time}}に精算",
      disputeLabel: "異議申立",
      redeem: "償還",
      locked: "ロック中",
      lockedTitle: "異議申立期間中は償還できません",
      trade: "取引",
    },
    activity: {
      title: "オンチェーンイベントフィード",
      subtitle: "SDK decodeLogsが生ログを解析 · 8秒ごとにeth_getLogsを差分取得",
      error: "ログの取得に失敗しました：{{error}}",
      emptyTitle: "まだイベントはありません",
      emptyHint:
        "デプロイ以降、マーケット作成や約定がなければログは空です。最初のcreateMarket / SharesBoughtがここにリアルタイムで表示されます。",
      txLink: "トランザクションを表示 →",
      decodeTitle: "decodeLog(args)",
    },
    create: {
      open: "+ 新規マーケット",
      title: "新規マーケット",
      subtitle:
        "marketId = keccak256(question|category|timestamp)。CREATORロールが必要で、オンチェーンに載ると変更できません。",
      questionLabel: "質問（8〜280バイト）",
      questionPlaceholder: "例：BTCは24時間以内に81,000ドルを突破しますか？",
      categoryLabel: "カテゴリ",
      hoursLabel: "解決期間（時間）",
      seedLabel: "初期流動性（USDC、任意）",
      cancel: "キャンセル",
      submit: "作成",
      noWallet: "先にウォレットを接続してください",
      submittedTitle: "マーケット作成を送信しました",
      seededTitle: "流動性供給を送信しました",
      seededBody: "{{amount}} USDCを供給しました",
      liveTitle: "マーケット公開",
      failedTitle: "マーケット作成に失敗しました",
    },
  },

  marketing: {
    board: {
      title: "トップ予測者",
      badge: "シミュレート集団",
      season: "サンプルブック · 出来高{{volume}}k",
      colPredictor: "予測者",
      colTrades: "取引",
      colHit: "的中",
      colPnl: "PnL（模擬）",
      footnote:
        "順位はサンプルブックによるもので、実際のアカウントではありません。ライブウォレット0件、デプロイ以降のオンチェーン約定{{fills}}件。ここにある数値はすべてシミュレートされたFAKE-USDCです。",
    },
    ticker: {
      title: "ライブ約定",
      sample: "サンプルストリーム",
      live: "ライブ",
      hint: "シミュレートブック · 7秒ごとに更新",
    },
    spotlight: {
      eyebrow: "AIデスク · スポットライト",
      title: "255マーケット。5つのカテゴリ。1つのカーブ。",
      body: "政治、暗号資産、スポーツ、eスポーツ、フロンティアテック — Base上で精算される同一の定数積マーケットメイカーが価格を付けます。",
      cta: "全マーケットを見る",
    },
    pool: {
      eyebrow: "初心者プール · シーズン1",
      title: "あなたは賞金プールに入っています",
      body: "新しい予測者は全員同じ25,000 FAKE-USDCのプールに参加します。サイドを取るたびにあなたのシェアが増えます — すべてローカルで決済され、実際の資金は動きません。",
      share: "あなたのシェア",
      joined: "今シーズン{{count}}人が参加",
      cta: "予測を始める",
      footnote:
        "シミュレートプール。チップはローカルで、引き出し不可、金銭的価値はありません。",
    },
  },

  social: {
    card: {
      simPosition: "模擬ポジション",
      untitled: "無題のマーケット",
      settled: "精算済み",
      yesChance: "YESの勝率",
      noChance: "NOの勝率",
      liquidity: "流動性 {{amount}}",
      volume: "出来高 {{amount}}",
      position: "あなたのポジション · YES {{yes}} / NO {{no}}",
      paperValue: "ペーパー評価額 {{amount}}",
      closesPrefix: "終了 ",
      disputePrefix: "異議申立 ",
      disputeNotice:
        "異議申立期間1時間 — Safeが結果を覆す可能性があります。引き出しは停止中。",
      shareFallbackQuestion: "AI予測マーケット",
      loading: "Multicall3でオンチェーンマーケットを取得中…",
      errorTitle: "オンチェーンデータを読み取れませんでした",
      emptyTitle: "このセクターにはまだオンチェーンマーケットがありません",
      emptyHint:
        "Hermesブレインがマーケットを供給・形成するには、資金のあるウォレットにUSDCが必要です。以下の注目デモマーケットは、今すぐペーパーチップで一連の注文フローを体験できます。",
    },
    comments: {
      title: "ディベートウォール · {{count}}件の見解",
      localOnly: "このブラウザに保存",
      yesWins: "YESの勝ち",
      noWins: "NOの勝ち",
      neutral: "中立",
      neutralTally: "中立 {{count}}",
      stanceWins: "{{side}}の勝ち",
      nickname: "ニックネーム（任意）",
      placeholder: "サイドを選んで — YESとNO、どちらが勝つ理由？",
      counter: "{{count}}/500 · 違法な内容は禁止",
      submit: "投稿",
      empty: "まだ見解はありません — 最初に投稿しましょう。",
      official: "公式トピック",
      delete: "削除",
      secondsAgo: "{{n}}秒前",
      minutesAgo: "{{n}}分前",
      hoursAgo: "{{n}}時間前",
      daysAgo: "{{n}}日前",
    },
    ai: {
      desk: "Hermes AIデスク",
      tone: {
        bull: "強気",
        bear: "弱気",
        warn: "リスク",
        geek: "クオンツ",
        calm: "中立",
      },
      live: "ブレインからライブ",
      local: "ローカルモデル",
      updated: "{{time}}に更新",
      basisFallback: "オンチェーンのプール深度とニュースの脈動",
      disclaimerBrain:
        "公開データに基づきルール／ブレインが作成。投資助言ではありません。出典：Hermesブレインのサイクル。",
      disclaimerLocal:
        "公開データに基づきルール／ブレインが作成。投資助言ではありません。出典：フロントエンドのルールエンジン（ブレインはオフライン）。",
    },
    share: {
      label: "共有",
      tooltip: "X用のシェアカードを生成",
      generating: "生成中…",
      heading: "シェアカード",
      geometry: "1200×630 · 招待QR付き",
      close: "閉じる",
      alt: "シェアカード",
      download: "PNGをダウンロード",
      postOnX: "Xに投稿",
      copyText: "投稿文をコピー",
      failed: "カードの生成に失敗しました：{{err}}",
    },
  },

  airdrop: {
    eyebrow: "エアドロップ · ペーパー取引",
    headline: "ウェルカムボーナス",
    body: "ウォレットもUSDCも不要。10,000 FAKE-USDCのペーパーチップが、アクセスした瞬間に自動で付与されました。",
    chipsUnit: "FAKE-USDC · ペーパーチップ",
    credited: "付与済み · いつでもリセット可能",
    badges: {
      marketsValue: "12",
      markets: "注目マーケット",
      quotesValue: "CPMM",
      quotes: "気配値",
      aiValue: "◈",
      ai: "AIの見解",
    },
    ctaBalance: "取引を始める · 残高 {{balance}} FAKE",
    finePrintPaper:
      "ペーパーモード。模擬マネーのみで、実際の資産には一切触れません。右上からいつでも実弾に切り替えられます。",
    finePrintReal:
      "現在は実弾モードです。ペーパーチップはそのまま保持され、戻したときにすぐ使えます。",
  },

  ui: {
    countdown: {
      expired: "期限切れ",
    },
    loader: {
      connecting: "Baseメインネットに接続中…",
    },
    wordmark: {
      subtitle: "AI予測マーケット · Base",
    },
    toast: {
      explorerLink: "Basescanで見る →",
    },
    empty: {
      fallbackTitle: "まだ何もありません",
    },
  },
  terminal: {
    locale: {
      label: "言語",
      hint: "表示言語",
      current: "現在の言語",
      saved: "言語設定を保存しました",
    },
    hero: {
      eyebrow: "世界のヘッドライン",
      title: "世界が明日の価格を決めている",
      body: "地政学、中央銀行、先端テック、eスポーツ、カルチャーを横断するリアルタイム確率。",
      previous: "前の記事",
      next: "次の記事",
      pause: "自動送りを停止",
      play: "自動送りを再開",
      slide: "{{index}} / {{total}}",
      probability: "YES",
      move: "直近1時間で {{delta}}",
      cta: "マーケットを開く",
      depth: "流動性 {{amount}} USDC",
      settling: "{{hours}} 時間後に確定",
    },
    whale: {
      title: "クジラの資金フロー",
      hint: "25,000ドル以上の約定",
      sample: "シミュレーション・テープ",
      live: "オンチェーン・テープ",
      bought: "買い",
      sold: "売り",
      ago: "{{mins}} 分前",
      justNow: "たった今",
      note: "25,000ドル超の大口約定のみ表示。",
    },
    depth: {
      title: "マーケット深度",
      yes: "YES 板",
      no: "NO 板",
      price: "仲値",
      sweep: "{{amount}} の約定価格",
      capacity: "深度",
      unit: "USDC",
      levels: "{{count}} 段",
      axis: "価格",
    },
    sync: {
      title: "クラウド同期",
      local: "この端末のみ",
      ready: "同期待ち",
      syncing: "同期中",
      synced: "同期済み",
      error: "同期に失敗",
      connectWallet: "ウォレットを接続すると自動同期",
      body: "ペーパー残高、ポジション、約定履歴、紹介台帳、議論ウォールの投稿はウォレットに紐づいて端末をまたいで同期されます。ブラウザを離れる前に、署名から導出した鍵で AES-GCM 暗号化されます。",
      lastSync: "最終同期 {{time}}",
      push: "今すぐ送信",
      pull: "今すぐ取得",
      device: "この端末",
      cipher: "AES-GCM · ウォレット導出鍵",
      provider: "経路",
    },
  },
} satisfies Messages;
