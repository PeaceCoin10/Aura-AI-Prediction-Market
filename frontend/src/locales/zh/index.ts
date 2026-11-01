import type { Messages } from "../en";

/**
 * Simplified Chinese (zh-CN) message tree. Mirrors en 1:1.
 *
 * Terminology: 真金模式 / 模拟盘 for Real / Paper, 盘口 for the order book,
 * 裁决 for resolution, 争议期 for the dispute window, 持仓 for positions,
 * 赎回 for redeem, 价格冲击 for price impact, 滑点 for slippage.
 */
export const zh = {
  shell: {
    brand: {
      name: "Aura",
      wordmark: "AURA",
      tagline: "智能体预测市场",
      descriptor: "AI 撰写市场 · CPMM 定价 · Base 主网",
    },
    tabs: {
      feed: "市场",
      portfolio: "持仓",
      activity: "链上",
      feedShort: "市场",
      portfolioShort: "资产",
      activityShort: "事件",
    },
    nav: {
      hot: "热门",
      crypto: "加密",
      news: "新闻",
      sports: "体育",
      esports: "电竞",
      tech: "科技",
      other: "其他",
    },
    navHints: {
      hot: "全板块，按活跃度排序",
      crypto: "主流币、DeFi 与链上资金流",
      news: "国际新闻、地缘政治、宏观",
      sports: "NBA · NFL · 英超 · 欧冠",
      esports: "LoL · CS2 · VCT",
      tech: "AI、芯片与监管",
    },
    mode: {
      real: "真金",
      paper: "模拟盘",
      realTitle: "真金模式 — 连接钱包，在 Base 上用 USDC 交易。",
      paperTitle: "模拟盘 — 赠送 10,000 FAKE-USDC，无需钱包，零风险。",
      switchedPaper: "已切换至模拟盘",
      switchedPaperBody: "已发放 10,000 FAKE-USDC。全程链下、零风险，可完整演练交易流程。",
      switchedReal: "已切换至真金模式",
      switchedRealBody: "连接钱包即可在 Base 上交易真实 USDC，请谨慎控制仓位。",
    },
    sound: {
      on: "音效已开 — 点击静音",
      off: "已静音 — 点击开启",
    },
    actions: {
      connect: "连接钱包",
      disconnect: "断开连接",
      switchChain: "切换到 Base",
      switchFailed: "网络切换失败",
      security: "安全",
      securityTitle: "安全矩阵：Slither、不变量测试、争议期",
      docs: "文档",
      docsTitle: "文档：快速上手、AI 架构、SDK",
      refresh: "刷新",
      refreshing: "刷新中…",
      close: "关闭",
      affiliate: "推荐计划 · 手续费的 20%",
      search: "搜索市场、分类、战队…",
      newMarket: "新建市场",
      claimChips: "领取 10,000 筹码",
      resetChips: "重置筹码",
      resetChipsTitle: "将模拟余额恢复至 10,000 并清空模拟持仓",
      connectToView: "连接钱包以查看持仓",
    },
    status: {
      rpc: "Base RPC",
      rpcDown: "无法连接",
      brain: "Hermes 大脑",
      heartbeat: "心跳正常",
      lastCycle: "上次周期 {{min}} 分钟前",
      idle: "空闲 — 为钱包充值以播种市场",
      security: "安全矩阵",
      docs: "文档中心",
    },
    locale: {
      label: "语言",
      active: "中文",
    },
    footer: {
      engine: "CentralPredictionEngine",
      chain: "Base · 链 ID 8453",
      fees: "交易手续费 1.5% / 结算手续费 0.5%",
      dispute: "1 小时争议期",
      rights: "开源 · MIT",
    },
    toasts: {
      copied: "已复制到剪贴板",
      copyFailed: "复制失败 — 请手动选择文本",
    },
  },

  hall: {
    heroTitleA: "AI 预测市场",
    heroTitleB: "由自己写盘口的大脑驱动",
    heroBody:
      "Hermes 每五分钟依据实时加密、新闻、体育与电竞数据流起草市场。定价由 Base 上的恒定乘积做市商完成 — 每次刷新一次 Multicall3 读取，15 秒一个周期。",
    statsPaper: {
      featured: "精选市场",
      cadence: "跳动周期",
      cadenceValue: "7 秒",
      volume: "模拟成交额",
      chain: "链上市场",
    },
    statsReal: {
      chain: "链上市场",
      active: "交易中",
      liquidity: "池内流动性",
      featured: "精选市场",
    },
    paperBar: {
      label: "模拟盘",
      balance: "余额",
      hint: "无需钱包 — 12 个精选市场、实时模拟行情、AI 观点与辩论墙全部运行中。",
      hintCount:
        "无需钱包 — {{count}} 个精选市场、实时模拟行情、AI 观点与辩论墙全部运行中。",
    },
    sections: {
      featuredTitle: "精选市场",
      featuredBadge: "链下 · 可全额交易",
      featuredNote: "每 7 秒模拟跳动 · 报价复用真实 CPMM 算法",
      chainTitle: "链上实时市场",
      chainNote:
        "CentralPredictionEngine 已部署且未暂停，但尚未播种任何市场。Hermes 大脑需要钱包中有 USDC 才能创建并播种市场。",
      chainEmptyTitle: "暂无链上市场",
      chainEmptyBody:
        "下方全部是精选市场：相同的 CPMM 算法、相同的交易流程 — 仅在本地结算，几秒内即可从零到持仓。",
      demoEmptyTitle: "该板块暂无内容",
      demoEmptyHint: "切回热门，或选择其他板块。",
      refreshFailed: "刷新失败 — 正在显示上一份正常快照：",
    },
    portfolio: {
      title: "持仓",
      subtitle: "持仓即引擎内部的 yesOf / noOf 账本（ERC-1155 语义）；通过 redeem() 提取。",
    },
    connect: {
      title: "连接钱包",
      google: "Google",
      email: "邮箱",
      socialNote: "一键智能账户 — 首次交易免 Gas。",
      body:
        "EIP-6963 发现机制覆盖所有注入式钱包 — MetaMask、Coinbase、Rabby 及任意 EOA。连接后将提示切换至 Base 主网（8453）。",
      empty:
        "未检测到钱包插件。请安装 MetaMask 或 Coinbase Wallet 后刷新 — 也可用模拟筹码交易上方精选市场。",
      connecting: "连接中…",
      failed: "连接失败",
    },
    paused:
      "协议已暂停：新交易将被拒绝。仅处理结算与争议期结束后的提现。",
  },

  /** Market copy and data-layer strings. Templates use `{{var}}`, rendered by `format()` from `lib/i18n`. */
  content: {
    demoMarkets: {
      "demo-btc-88k": {
        question: "BTC 会在 24 小时内突破 $88,000 吗？",
        criteria:
          "若结算时 BTC/USD 现货价 ≥ $88,000（以 CoinGecko 为主，Binance 备用）则裁决 YES，否则 NO。",
      },
      "demo-eth-etf": {
        question: "本周会有 ETH 现货 ETF 录得单日超过 $500M 的净流入吗？",
        criteria:
          "若 Farside / SoSoValue 的官方资金流数据显示任一单日净流入高于 $500M，则裁决 YES。",
      },
      "demo-defi-tvl": {
        question: "DeFi 总锁仓量会在 48 小时内重回 $120B 吗？",
        criteria: "若结算时全链 TVL 快照按 DefiLlama 数据 ≥ $120B，则裁决 YES。",
      },
      "demo-fed-cut": {
        question: "美联储会在下一次 FOMC 声明中明确提及降息吗？",
        criteria:
          "若发布于美联储官网的 FOMC 声明中出现任何降息相关表述，则裁决 YES，否则 NO。",
      },
      "demo-ceasefire": {
        question: "本周会有至少两家主流媒体确认停火协议吗？",
        criteria:
          "若结算前路透社、美联社与 BBC 中至少两家独立报道该停火，则裁决 YES；同一通讯社稿件被转载不计为第二家媒体。",
      },
      "demo-ai-act": {
        question: "欧盟《AI 法案》实施细则会在本月生效吗？",
        criteria:
          "仅当文本在官方公报（OJ）上发布时裁决 YES；委员会批准但未在 OJ 发布则裁决 NO。",
      },
      "demo-nba-celtics": {
        question: "波士顿凯尔特人会在今晚的 NBA 比赛中击败布鲁克林篮网吗？",
        criteria:
          "以 ESPN 官方最终比分（含加时）结算：凯尔特人获胜 → YES；失利或平局 → NO；延期超过 24 小时 → INVALID 并退款。",
      },
      "demo-epl-derby": {
        question: "阿森纳会在本轮英超中击败切尔西吗？",
        criteria:
          "以英超官方最终比分（含补时）结算：阿森纳获胜 → YES；平局或失利 → NO。",
      },
      "demo-nfl-chiefs": {
        question: "堪萨斯城酋长会在客场取胜吗？",
        criteria: "以 NFL 官方最终比分结算：酋长获胜 → YES；平局或失利 → NO。",
      },
      "demo-lol-t1": {
        question: "T1 会在全球总决赛淘汰赛中击败 Movistar KOI 吗？",
        criteria:
          "以 LoL Esports 官方结果（gameWins）结算：T1 赢下系列赛 → YES，否则 NO。",
      },
      "demo-cs2-major": {
        question: "欧洲赛区会在 CS2 Major 小组赛中赢下超过 60% 的比赛吗？",
        criteria: "按 HLTV 官方赛事统计：结算时欧洲胜率高于 60% → YES，否则 NO。",
      },
      "demo-valorant": {
        question: "Sentinels 会以 2:0 赢下下一场 VCT 比赛吗？",
        criteria: "按 VCT 官方结果：比分恰为 2:0 → YES；其他任何比分 → NO。",
      },
    },

    /** Seeded debate-wall posts, keyed by demo market id. */
    seedComments: {
      "demo-btc-88k": [
        { author: "0x巨鲸", stance: "YES", text: "ETF 资金还在源源不断进场。88k 只是时间问题，24 小时足够。" },
        { author: "中本聪的猫", stance: "NO", text: "86k 上方挂着一层厚厚的清算墙，冲不过去。" },
      ],
      "demo-eth-etf": [
        { author: "DeFi研究员", stance: "YES", text: "只要质押型 ETF 获批，单日 $500M 根本不算什么。" },
      ],
      "demo-fed-cut": [
        { author: "宏观猎手", stance: "NO", text: "点阵图依然偏鹰，声明里不会出现降息这个词。" },
        { author: "债券交易员", stance: "YES", text: "通胀数据已经回落，措辞转鸽的概率本来就有 40%。" },
      ],
      "demo-nba-celtics": [
        { author: "场边老手", stance: "YES", text: "主场对阵背靠背作战的球队，悬念不大。" },
      ],
      "demo-lol-t1": [
        { author: "峡谷分析师", stance: "YES", text: "T1 的 BP 准备更充分，BO5 经验差距是实打实的。" },
        { author: "KOI铁粉", stance: "NO", text: "这个版本利好 KOI 的前期节奏，爆冷在即。" },
      ],
    },

    /** Local rule-engine commentary. Only uses pool state: probability, depth, volume, time left. */
    insights: {
      flavor: {
        crypto: "链上资金流",
        news: "新闻通讯流",
        tech: "科技叙事",
        sports: "体育盘口",
        esports: "电竞生态",
        fallback: "盘口",
      },
      crowded:
        "YES 已达 {{prob}}% — 多头极度拥挤。此时买入意味着赔率不再占优；一笔大额卖单就可能打出两位数回撤。",
      edge:
        "多头在 {{prob}}% 处略占优势，但{{flavor}}尚未给出决定性信号 — 建议分批建仓，而非一次性打满。",
      neutral:
        "概率卡在 {{prob}}%，正处于中性区间正中：多空双方都在等待新信息。做市方在此最为舒适，主动成交者则两头挨打。",
      fade:
        "空头小幅领先（YES {{prob}}%）。这是「便宜但需要催化剂」的结构 — 只有小仓反向押注才有合适的赔率。",
      priced:
        "YES 已跌至 {{prob}}% — 市场几乎已完全定价该结果。除非{{flavor}}出现黑天鹅式反转，残值已所剩无几。",
      thinPool: " 池深度仅 {{depth}} USDC，100 USDC 就能推动价格 — 注意冲击成本。",
      heavyVolume: " 成交额（{{vol}} USDC）已达池深度的 {{multiple}} 倍 — 换手极重。",
      closingSoon: " 距结算不足 1 小时 — 争议期一旦开启，提现即被锁定。",
      finalHours: " 距结算还有 {{hours}} 小时；最后阶段通常波动最大。",
      basis: "概率 {{prob}}% · 深度 {{depth}} USDC · 成交 {{vol}} USDC",
    },

    /** Event names as shown on toasts and the activity feed. */
    eventLabels: {
      MarketCreated: "市场已创建",
      MarketCategoryUpdated: "分类已更新",
      LiquiditySeeded: "流动性已注入",
      SharesBought: "买入成交",
      SharesSold: "卖出成交",
      MarketResolved: "市场已裁决",
      DisputeWindowOpened: "争议期已开启",
      ResolutionOverridden: "结果已推翻",
      ResolutionFinalized: "结果已定案",
      Redeemed: "赎回已支付",
      ResidualSwept: "残余已清扫",
      FeeVaultUpdated: "费用金库已更新",
      TreasuryUpdated: "国库已更新",
      CreatorUpdated: "创建权限已变更",
      OracleUpdated: "裁决权限已变更",
      Paused: "协议已暂停",
      Unpaused: "协议已恢复",
      AdminTransferStarted: "管理员转移已发起",
      AdminTransferred: "管理员已转移",
    },

    /** Feed / toast bodies. `{{var}}` is substituted from decoded event args. */
    eventFeed: {
      createdTitle: "{{label}}：{{question}}",
      createdBody: "分类 {{category}} · 结算 {{when}}",
      liquidityBody: "已向池中注入 {{amount}} USDC",
      tradeTitle: "{{label}} · {{outcome}}",
      buyBody: "支付 {{amount}} USDC → 获得 {{shares}} 份（手续费 {{fee}}）",
      sellBody: "卖出 {{shares}} 份 → 收到 {{amount}} USDC",
      resolvedTitle: "{{label}}：{{outcome}}",
      resolvedBody: "1 小时争议期 — Safe 可推翻",
      resolvedBodyEmergency: "紧急退款通道",
      disputeBody: "争议期至 {{when}}；期间赎回锁定",
      overrideTitle: "{{label}}：{{from}} → {{to}}",
      overrideBody: "结果已被推翻 {{count}} 次",
      redeemedBody: "赔付 {{payout}} USDC（销毁 YES {{yes}} / NO {{no}}）",
      pausedBody: "交易与赎回已暂停（紧急提现窗口除外）",
    },

    /** Resolution wording, shared by the feed and the market cards. */
    outcomes: {
      yesWins: "YES 获胜",
      noWins: "NO 获胜",
      invalid: "无效（每份支付 0.5）",
    },

    /** Market lifecycle labels; keys mirror `MarketPhase`. */
    phase: {
      trading: "交易中",
      awaiting: "待裁决",
      disputing: "争议期内",
      final: "已定案",
      closed: "已关闭",
      empty: "未找到",
    },

    /** Paper-trading failures, shown inline next to the trade button. */
    paper: {
      amountPositive: "数量必须大于 0",
      insufficientBalance: "模拟余额不足 — 请先领取 10,000 FAKE-USDC",
      noShares: "该数量无法买入任何份额 — 池子太薄或数量过小",
      noPosition: "该市场无模拟持仓",
      exceedsPosition: "卖出数量超过持仓",
      depthTooThin: "当前深度无法承接该笔卖出",
    },

    /** Wallet errors surfaced through the connect flow. */
    wallet: {
      noProvider: "未检测到钱包插件 — 请安装 MetaMask 或 Coinbase Wallet",
      noAccounts: "钱包未返回任何账户",
      notConnected: "钱包未连接",
      fallbackName: "浏览器钱包",
      hookOutsideProvider: "useWallet 必须在 <WalletProvider> 内使用",
    },

    mode: {
      hookOutsideProvider: "useMode 必须在 <ModeProvider> 内使用",
    },

    /** Shared formatting strings. */
    format: {
      expired: "已结束",
      unknownError: "未知错误",
      dayUnit: "天",
    },

    /** Slippage preset hints. */
    slippage: {
      conservative: "保守",
      default: "默认",
      aggressive: "激进",
    },

    /** Share poster + X intent copy. */
    poster: {
      tagline: "智能体 DeFi · AI 预测市场",
      modePaper: "模拟",
      modeReal: "实盘",
      sideNeutral: "观望",
      sideBet: "押注 {{side}}",
      probLabel: "当前 YES 概率",
      returnLabel: "潜在回报",
      scanQr: "扫码打开市场",
      footer: "Base 主网 · 合约已验证 · 1 小时争议期 · 1.5% 交易手续费",
      canvasUnavailable: "Canvas 不可用",
      tweetLeadNeutral: "观望中",
      tweetLeadBet: "押注 {{side}}",
      tweet: '{{lead}}「{{question}}」| YES {{prob}}%{{potential}} #AIPredictionMarkets #Base #Aura',
      tweetPotential: "，潜在回报 {{ret}}",
    },
  },

  /** Risk disclosure, security matrix, docs portal. Templates use `{{var}}` via `format()`. */
  security: {
    common: {
      close: "关闭",
    },

    risk: {
      title: "风险披露与使用条款",
      bulletProtocol:
        "Aura 是去中心化预测市场协议，并非投资顾问，本页任何内容均不构成投资建议。",
      bulletPrice:
        "份额价格由 AMM 曲线决定，可能归零。请仅投入你能承受损失的 USDC。",
      bulletDispute:
        "结算设有 1 小时争议期。期间提现关闭，Safe 多签可在该窗口内推翻结果。",
      bulletPaper:
        "模拟盘使用本地虚拟筹码，不涉及任何真实资产，筹码无法赎回。",
      bulletAudit:
        "合约开源并已在 Base 主网完成验证，但任何审计都无法保证零风险。",
      consent:
        "继续即表示你确认已阅读并接受上述条款，且你所在司法辖区允许参与此类产品。",
      ack: "我已了解风险 — 进入市场",
    },

    drawer: {
      title: "安全矩阵",
      slither: {
        title: "静态分析 · Slither",
        high: "高危",
        medium: "中危",
        low: "低危",
      },
      tests: {
        title: "测试矩阵",
        forgeLead: "forge test — ",
        forgeTail: " 项测试通过（单元 + 不变量）",
        invariantLead: "不变量测试：",
        invariantRunsDepth: " 轮 × 深度 ",
        invariantCallsLead: "，",
        invariantTail:
          " 次 handler 调用（8 个选择器，每个约 12,800 次），0 次回滚，0 项不变量被破坏",
        coverage: "SDK：70/70 离线用例 · 前端：11/11 实链 e2e + 55/55 UI e2e",
      },
      economics: {
        title: "经济与治理控制",
        feeLead: "手续费：",
        feeTail: " — 全部进入 ProtocolFeeVault；提现需 Safe 签名",
        disputeLead: "争议期：",
        disputeTail: "，市场裁决即刻开启；期间提现始终关闭",
        overrideLead: "推翻：",
        emergencyLead: "紧急退款：",
        emergencyWindow: "7 天",
        emergencyMid: " 结算时间之后，任何人可调用 ",
        emergencyTail: " 获得全额退款",
      },
      verified: {
        title: "已验证合约（Base 主网）",
        badge: "✓ 已验证",
      },
    },

    docs: {
      title: "文档中心",
      tabs: {
        start: "快速上手",
        brain: "Hermes AI 架构",
        sdk: "SDK 集成",
      },

      start: {
        headingPaper: "3 秒从零到持仓（无需钱包）",
        paperSteps: [
          "把右上角开关切到模拟盘 → 领取 10,000 筹码。",
          "在市场大厅任选一个市场，买入 YES 或 NO — 份额、均价与价格冲击实时计算。",
          "持仓面板实时跟踪未实现 PnL；卖出后直接结算回余额。",
        ],
        headingReal: "真金交易",
        realSteps: [
          "切到真金模式 → 连接钱包（自动切换至 Base，链 ID 8453）。",
          "选择市场 → 输入 USDC 数量 → 首笔交易需授权，面板会自动处理。",
          "提示会返回交易哈希，可在 Basescan 打开查看。",
          "市场裁决后进入 1 小时争议期；窗口结束后赎回开放。",
        ],
        headingFees: "手续费与结算",
        feesBody:
          "交易收取 1.5%，结算支付收取 0.5%。价格 = NO 储备 / 总储备，单笔交易硬性上限为池深度的 5%。",
      },

      brain: {
        headingEngines: "三大引擎，一个循环",
        creator: "创建",
        creatorBody:
          "：多来源数据摄取（CoinGecko/Binance、RSS 新闻、ESPN 记分板、LoL Esports）→ YES/NO 二元问题 → 创建市场并注入做市流动性",
        oracle: "裁决",
        oracleBody:
          "：价格类市场取 3×30 秒多次采样以抵御插针；体育与电竞仅在官方结果公布后裁决；新闻类市场从不自动结算 — 等待 Safe 或人工调用",
        marketing: "营销",
        marketingBody:
          "：每个新市场由模板引擎生成 Twitter / Telegram 文案，可选叠加一轮 LLM 润色",
        headingConstraints: "出题硬性约束",
        constraintsBody:
          "二元表述（会 / 不会）、结算时间在 30 分钟至 8 天之间，且裁决标准客观可验证。其余一律丢弃。",
        headingCommentary: "点评",
        commentaryLead: "每个周期，大脑都会把关于真实市场的点评写入 ",
        commentaryTail:
          "；前端每 60 秒轮询一次。大脑离线时，前端改用本地规则引擎，并将输出标注为本地推理。",
      },

      sdk: {
        headingInstall: "安装与连接",
        headingRead: "读取市场（一次 Multicall3）",
        headingOrder: "下单",
        footnote:
          "SDK 内置离线报价 previewBuyOffline / previewSellOffline，与链上 previewBuy 精确到 wei 对齐；decodeLogs 将原始事件转换为结构化通知。",
      },
    },
  },

  /** On-chain market detail and real trading panel. Templates use `{{var}}` via `format()`. */
  trade: {
    common: {
      close: "关闭",
    },

    market: {
      onChainChip: "链上市场",
      settlesPrefix: "结算 ",
      inPrefix: "剩余 ",
      untitled: "未命名市场",
      shareFallbackQuestion: "AI 预测市场",
      dataTitle: "市场数据（直接链上读取）",
      yesProb: "YES 概率",
      noProb: "NO 概率",
      yesReserve: "YES 储备",
      noReserve: "NO 储备",
      cash: "池内现金",
      owed: "应付总额",
      volume: "累计成交额",
      tradable: "可交易",
      yes: "是",
      no: "否",
      status: "结算状态",
      statusFinalized: "已定案",
      statusDispute: "争议中",
      statusUnresolved: "未裁决",
      outcome: "结果",
      rulesTitle: "规则",
      rulePricing:
        "价格 = NO 储备 / 总储备。交易经由 CPMM 执行，单笔订单硬性上限为池深度的 5%。",
      ruleFees: "交易名义金额收取 1.5% 手续费；结算支付收取 0.5% 手续费。",
      ruleDispute:
        "裁决开启 1 小时争议期。Safe（管理员）可推翻结果，期间提现全程关闭。",
      ruleEmergency:
        "若市场在结算时间后 7 天仍未裁决，任何人可调用 emergencyRefund 获得全额退款。",
    },

    panel: {
      poolDepth: "池深度",
      disputeLeft: "争议期剩余",
      settlesIn: "距结算",
      finalized: "已定案",
      awaitingFinalize: "待定案",

      disputeTitle:
        "处于 1 小时争议期内。Safe 仍可推翻结果，提现已关闭。",
      disputeBodyLead: "争议期剩余 ",
      disputeBodyMid: "，之后自动定案 — 任何人可调用 ",
      disputeBodyTail: " 写入定案事件。",

      position: "你的持仓",
      redeemTitleClosed: "争议期内提现已关闭",
      redeemDispute: "争议期内提现关闭",
      redeemReady: "赎回收益",
      redeemEmpty: "无可赎回持仓",
      redeemNote:
        "结算手续费 0.5%。INVALID 市场按每份 YES 与每份 NO 各支付 0.5 USDC。协议暂停期间，强制提现在结算时间 7 天后解锁。",

      buyShares: "买入份额",
      sellShares: "卖出份额",
      amountInLabel: "USDC 数量",
      sellLabel: "卖出份额数",
      sellable: "（上限 {{amount}}）",
      unitUsdc: "USDC",
      unitShares: "份",
      max: "最大",

      slippage: "滑点",
      capHint: "单笔上限 ≈ {{amount}} USDC（池深度的 5%）",

      quoteReceive: "你将获得",
      quoteReturn: "你将收回",
      quoteChain: "· 链上报价",
      quoteOffline: "· 离线估算",
      unitSharesSuffix: " 份",
      avgFill: "平均成交价",
      pricePerShare: "USDC/份",
      priceImpact: "价格冲击",
      impactCap: " / 上限 5%",
      tradingFee: "交易手续费",
      feeOnChain: "（链上扣除）",
      protectedPrice: "保护价格",
      protectedPriceValue: "{{amount}}（-{{slip}}）",
      impactWarnLead: "冲击已达上限的 80%（SDK 警告 ",
      impactWarnMid: "）。更大的订单会被 ",
      impactWarnTail: " 拒绝 — 请减少数量或拆单。",

      submitSettled: "市场已结算",
      submitClosed: "交易已关闭",
      buy: "买入 {{side}}",
      sell: "卖出 {{side}}",
      connectToTrade: "连接钱包以交易",

      confirmTitle: "价格冲击接近硬性上限",
      confirmBodyLead: "SDK 返回 ",
      confirmBodyMid: " — 该订单将占池深度的 ",
      confirmBodyTail:
        "%（合约上限 5%）。成交价将明显恶化，且动用真实资金。",
      confirmReduce: "减少数量",
      confirmProceed: "仍然执行",

      footerUsdc: "USDC",
      footerEngine: "引擎",
      footerNote: "链上结算，不可撤销",
    },

    toasts: {
      allowanceChecking: "正在检查 USDC 授权",
      allowanceBody: "spender = CentralPredictionEngine",
      submitted: "交易已提交，等待确认…",
      reverted: "交易已回滚（status = reverted）",
      confirmedEvent: "链上确认：{{event}}",
      confirmed: "链上确认",
      tradeFailed: "交易失败",
      connectFirst: "请先连接钱包",
      amountRequired: "请输入数量",
      redeemSubmitted: "赎回已提交",
      redeemConfirmed: "赎回已确认",
      redeemFailed: "赎回失败",
    },
  },

  paper: {
    card: {
      held: "持有",
      yesProbability: "YES 概率",
      noProbability: "NO 概率",
      tickTitle: "赔率每 7 秒刷新",
      depth: "深度 {{amount}} USDC",
      settlePrefix: "结算 ",
      expired: "已结束",
      volume: "成交额 {{amount}} USDC",
      debate: "💬 辩论 {{count}}",
      aiTag: "◈ AI",
      paperValue: "模拟价值 {{amount}} FAKE",
      sample: "示例",
      tickNote: "7 秒节奏 · 纸面成交",
      byAuthor: "— {{author}}",
    },
    detail: {
      offchainBadge: "链下市场 · 纸面结算",
      settledAt: "结算 {{time}}",
      remainingPrefix: "剩余 ",
      close: "关闭",
      bookTitle: "市场数据",
      yesProbability: "YES 概率",
      noProbability: "NO 概率",
      yesReserve: "YES 储备",
      noReserve: "NO 储备",
      volume: "累计成交额",
      source: "数据来源",
      mathNote:
        "概率即 CPMM 隐含价格；前端每 7 秒轻微偏移一次盘口，并明确标注为模拟。",
      criteriaTitle: "裁决标准",
    },
    panel: {
      badge: "模拟盘",
      balance: "余额 {{amount}} FAKE-USDC",
      claim: "领取 10,000 筹码",
      reset: "重置",
      resetTitle: "模拟账户已重置",
      resetBody: "筹码已恢复至 10,000 FAKE-USDC",
      buyYes: "YES · {{prob}}",
      buyNo: "NO · {{prob}}",
      amountLabel: "数量（FAKE-USDC）",
      amountPlaceholder: "0.00",
      max: "最大",
      slippage: "滑点",
      estShares: "预计份额",
      avgPrice: "平均价格",
      marginalPrice: "边际价格",
      minReceived: "最低获得（滑点保护）",
      impact: "冲击",
      impactWarning:
        "⚠ 警告：impact_near_limit — 冲击 {{impact}}，已接近合约 5% 上限。拆单成交成本更低。",
      buy: "买入 {{side}}",
      sell: "卖出 {{side}}（{{shares}}）",
      insufficientChips: "筹码不足（余额 {{amount}}）。请先领取或重置。",
      boardTitle: "模拟持仓 · PnL",
      boardEmpty: "暂无模拟持仓 — 下一笔成交将显示在此。",
      yesShares: "YES 份额",
      noShares: "NO 份额",
      invested: "总投入",
      markValue: "盯市价值（平仓）",
      disclaimer:
        "模拟盘：真实 CPMM 算法，本地筹码。链下运作、不可提取、不涉及任何真实资产。",
      errorTitleBuy: "模拟买单失败",
      errorTitleSell: "模拟卖单失败",
      toastBuyTitle: "模拟买入 {{side}} 已成交",
      toastBuyBody: "{{amount}} FAKE-USDC → {{shares}} 份 · 均价 ${{price}} · 链下，无成本",
      toastSellTitle: "模拟卖出 {{side}} 已成交",
      toastSellBody: "{{shares}} 份 → {{proceeds}} FAKE-USDC 已回到余额",
    },
    account: {
      title: "模拟账户",
      badge: "模拟盘",
      summary: "余额 {{balance}} FAKE-USDC · 持仓价值 {{value}}",
      unrealized: "未实现",
      claim: "领取 10,000 筹码",
      reset: "重置模拟账户",
      empty:
        "暂无模拟持仓。在市场大厅任意市场下单 — 盯市价值与 PnL 会实时显示在此，全部本地结算，无成本。",
      rowMeta: "YES {{yes}} / NO {{no}} · 投入 {{spent}} · 价值 {{value}}",
      footnote:
        "模拟盘在本地结算真实 CPMM 曲线。筹码不可提取、不可转让；只有真金模式才动用真实 USDC。",
    },
  },

  portfolio: {
    positions: {
      title: "持仓",
      connectTitle: "连接钱包以查看持仓",
      connectHint:
        "持仓存于引擎的链上 ERC-1155 账本（yesOf / noOf），本地不做任何缓存。",
      usdcBalance: "USDC 余额",
      unsettled: "未结算（份额）",
      sharesUnit: "份",
      redeemable: "可赎回市场",
      marketsUnit: "个市场",
      disputingUnit: "· {{count}} 个争议中",
      disputeTitle: "{{count}} 个市场处于 1 小时争议期",
      disputeTitlePlural: "{{count}} 个市场处于 1 小时争议期",
      disputeBody:
        "1 小时争议期内 Safe 仍可推翻结果，因此提现被锁定。倒计时结束或有人调用后，赎回才会开放",
      readingShares: "正在读取 sharesOf…",
      emptyTitle: "暂无持仓",
      emptyHint: "在市场大厅选一个市场，买入 YES / NO — 成交即刻上链。",
      groupRedeemable: "可赎回",
      groupDisputing: "争议中",
      groupOpen: "进行中",
      untitled: "（未命名市场）",
      yesPrice: "YES {{price}}",
      settles: "结算 {{time}}",
      disputeLabel: "争议",
      redeem: "赎回",
      locked: "锁定",
      lockedTitle: "争议期内不可赎回",
      trade: "交易",
    },
    activity: {
      title: "链上事件流",
      subtitle: "SDK decodeLogs 解析原始日志 · 每 8 秒增量 eth_getLogs",
      error: "日志获取失败：{{error}}",
      emptyTitle: "尚未捕获任何事件",
      emptyHint:
        "若引擎自部署以来没有创建过市场或成交，日志为空。首个 createMarket / SharesBought 会实时出现在此处。",
      txLink: "查看交易 →",
      decodeTitle: "decodeLog(args)",
    },
    create: {
      open: "+ 新建市场",
      title: "新建市场",
      subtitle:
        "marketId = keccak256(question|category|timestamp)。需要 CREATOR 角色；一旦上链即不可更改。",
      questionLabel: "问题（8–280 字节）",
      questionPlaceholder: "例如：BTC 会在 24 小时内突破 $81,000 吗？",
      categoryLabel: "分类",
      hoursLabel: "裁决窗口（小时）",
      seedLabel: "初始流动性（USDC，可选）",
      cancel: "取消",
      submit: "创建",
      noWallet: "请先连接钱包",
      submittedTitle: "市场创建已提交",
      seededTitle: "流动性注入已提交",
      seededBody: "已注入 {{amount}} USDC",
      liveTitle: "市场已上线",
      failedTitle: "市场创建失败",
    },
  },

  marketing: {
    board: {
      title: "预测排行榜",
      badge: "模拟用户群",
      season: "示例盘口 · 成交 {{volume}}k",
      colPredictor: "预测者",
      colTrades: "笔数",
      colHit: "胜率",
      colPnl: "PnL（模拟）",
      footnote:
        "排名来自示例盘口，而非真实账户：0 个真实钱包，自部署以来 {{fills}} 笔链上成交。此处所有数字均为模拟 FAKE-USDC。",
    },
    ticker: {
      title: "订单流",
      sample: "示例流",
      live: "实时",
      hint: "币安现货 · 真实成交",
    },
    spotlight: {
      eyebrow: "AI 交易台 · 焦点",
      title: "255 个市场。五大板块。一条曲线。",
      markets: "{{count}} 个市场",
      volume: "{{amount}} USDC 成交额",
      body: "政治、加密、体育、电竞与前沿科技 — 全部由同一个在 Base 上结算的恒定乘积做市商定价。",
      cta: "浏览全部市场",
    },
    pool: {
      eyebrow: "新手奖池 · 第 1 季",
      title: "你已进入奖池",
      body: "每位新预测者都加入同一个 25,000 FAKE-USDC 奖池。每次选边你的份额都会增长 — 本地结算，绝非真金。",
      share: "你的份额",
      joined: "本季已有 {{count}} 位预测者加入",
      cta: "开始预测",
      footnote: "模拟奖池。筹码为本地数据，不可提取，不具备任何货币价值。",
    },
  },

  social: {
    card: {
      simPosition: "模拟持仓",
      untitled: "未命名市场",
      settled: "已结算",
      yesChance: "YES 胜率",
      noChance: "NO 胜率",
      liquidity: "流动性 {{amount}}",
      volume: "成交额 {{amount}}",
      position: "你的持仓 · YES {{yes}} / NO {{no}}",
      paperValue: "模拟价值 {{amount}}",
      closesPrefix: "截止 ",
      disputePrefix: "争议 ",
      disputeNotice: "1 小时争议期 — Safe 可推翻结果，提现已暂停。",
      shareFallbackQuestion: "AI 预测市场",
      loading: "正在通过 Multicall3 拉取链上市场…",
      errorTitle: "无法读取链上数据",
      emptyTitle: "该板块暂无链上市场",
      emptyHint:
        "Hermes 大脑需要钱包中有 USDC 才能播种并做市。下方精选演示市场目前可用模拟筹码走完整下单流程。",
    },
    comments: {
      title: "辩论墙 · {{count}} 条观点",
      localOnly: "仅存储于本浏览器",
      yesWins: "YES 胜",
      noWins: "NO 胜",
      neutral: "中立",
      neutralTally: "中立 {{count}}",
      stanceWins: "{{side}} 胜",
      nickname: "昵称（可选）",
      placeholder: "选边站 — 为什么 YES 或 NO 会赢？",
      counter: "{{count}}/500 · 禁止违法内容",
      submit: "发布",
      empty: "暂无观点 — 来做第一个。",
      official: "官方话题",
      delete: "删除",
      secondsAgo: "{{n}} 秒前",
      minutesAgo: "{{n}} 分钟前",
      hoursAgo: "{{n}} 小时前",
      daysAgo: "{{n}} 天前",
    },
    ai: {
      desk: "Hermes AI 交易台",
      tone: {
        bull: "看涨",
        bear: "看跌",
        warn: "风险",
        geek: "量化",
        calm: "中性",
      },
      live: "大脑实时输出",
      local: "本地模型",
      updated: "更新于 {{time}}",
      basisFallback: "链上池深度与新闻热度",
      disclaimerBrain:
        "由规则 / 大脑依据公开数据撰写。非投资建议。来源：Hermes 大脑周期。",
      disclaimerLocal:
        "由规则 / 大脑依据公开数据撰写。非投资建议。来源：前端规则引擎，大脑离线。",
    },
    share: {
      deepLink: "深链",
      copied: "已复制",
      shareIn: "在 Telegram 内分享",
      shareSheet: "打开 Telegram 分享面板",
      template: "在 Aura 上交易 → #PredictionMarkets #Base #AI",
      label: "分享",
      tooltip: "生成 X 分享卡片",
      generating: "生成中…",
      heading: "分享卡片",
      geometry: "1200×630 · 含邀请二维码",
      close: "关闭",
      alt: "分享卡片",
      download: "下载 PNG",
      postOnX: "发布到 X",
      copyText: "复制文案",
      failed: "卡片生成失败：{{err}}",
    },
  },

  airdrop: {
    eyebrow: "空投 · 模拟盘",
    headline: "欢迎奖励",
    body: "无需钱包、无需 USDC。你进入的瞬间已自动发放 10,000 FAKE-USDC 模拟筹码。",
    chipsUnit: "FAKE-USDC · 模拟筹码",
    credited: "已发放 · 可随时重置",
    badges: {
      marketsValue: "12",
      markets: "个精选市场",
      quotesValue: "CPMM",
      quotes: "报价",
      aiValue: "◈",
      ai: "AI 观点",
    },
    ctaBalance: "开始交易 · 余额 {{balance}} FAKE",
    finePrintPaper:
      "模拟盘。仅为模拟资金，不触及任何真实资产。随时可在右上角切换至真金模式。",
    finePrintReal:
      "你当前处于真金模式。模拟筹码仍保留在此，切回后即可继续使用。",
  },

  ui: {
    countdown: {
      expired: "已结束",
    },
    loader: {
      connecting: "正在连接 Base 主网…",
    },
    wordmark: {
      subtitle: "AI 预测市场 · Base",
    },
    toast: {
      explorerLink: "在 Basescan 查看 →",
    },
    empty: {
      fallbackTitle: "暂无内容",
    },
  },
  terminal: {
    locale: {
      label: "语言",
      hint: "界面语言",
      current: "当前语言",
      saved: "语言偏好已保存",
    },
    hero: {
      eyebrow: "全球头条",
      title: "世界正在为明天定价",
      body: "覆盖地缘政治、央行宏观、前沿科技、电竞与流行文化的实时概率。",
      previous: "上一条",
      next: "下一条",
      pause: "暂停轮播",
      play: "继续轮播",
      slide: "{{index}} / {{total}}",
      probability: "是",
      move: "过去一小时 {{delta}}",
      cta: "进入盘口",
      depth: "深度 {{amount}} USDC",
      settling: "{{hours}} 小时后结算",
    },
    whale: {
      title: "巨鲸资金流",
      hint: "≥ $25k 大单 · 币安现货",
      sample: "模拟盘口播报",
      live: "链上实时",
      bought: "买入",
      sold: "卖出",
      ago: "{{mins}} 分钟前",
      justNow: "刚刚",
      note: "真实交易所成交，非本平台撮合",
    },
    depth: {
      title: "实时深度",
      yes: "是方向盘口",
      no: "否方向盘口",
      price: "中间价",
      sweep: "{{amount}} 成交价",
      capacity: "深度",
      unit: "USDC",
      levels: "{{count}} 档",
      axis: "价格",
    },
    sync: {
      title: "云端同步",
      local: "仅本机",
      ready: "待同步",
      syncing: "同步中",
      synced: "已同步",
      error: "同步失败",
      connectWallet: "连接钱包后自动同步",
      body: "模拟盘余额、持仓、成交历史、推荐台账与辩论墙观点将跟随你的钱包跨设备同步。数据离开浏览器前，已用由你的签名派生出的密钥做 AES-GCM 加密封存。",
      lastSync: "上次同步 {{time}}",
      push: "立即推送",
      pull: "立即拉取",
      device: "本设备",
      cipher: "AES-GCM · 钱包派生密钥",
      provider: "通道",
    },
  },

  affiliate: {
    eyebrow: "推荐计划",
    title: "赚取协议手续费的 20%",
    body: "分享你的专属链接。被该链接归因的每一笔交易，都会按 1.5% 交易手续费的 20% 直接计入你的奖励。",
    close: "关闭",
    closeAria: "关闭推荐面板",
    inviteLabel: "你的邀请链接",
    copy: "复制链接",
    copyTg: "复制 Telegram 链接",
    copied: "已复制",
    share: "分享",
    shareText: "在 Base 上交易由 AI 撰写的预测市场 — 255 个盘口在线",
    connectHint: "连接钱包即可生成你的专属链接 — 在连接之前地址位保持为空。",
    invites: "邀请打开数",
    volume: "归因成交额",
    rebate: "预估返佣 (USDC)",
    onchain: "链上余额",
    pool: "奖池 {{amount}} USDC",
    ledgerMissing: "账本尚未部署",
    claim: "领取",
    claiming: "领取中…",
    claimed: "返佣已领取 — USDC 已到你的钱包。",
    claimFailed: "领取失败。",
    poolTopping: "返佣奖池正在补充 — 奖池覆盖你的余额后即可完成领取。",
    arrived: "你通过 {{addr}} 进入。该地址会作为 calldata 元数据随你的真实订单一起提交。",
    noReferrer: "此浏览器尚未捕获推荐人。",
    noteReady: "上方的邀请数与成交额仅保存在本设备；链上余额由 ReferralLedger 结算。",
    noteLocal: "上方的邀请数与成交额仅保存在本设备。部署 ReferralLedger 并设置 VITE_REFERRAL_LEDGER 后即可开启链上发放。",
  },

  live: {
    badge: "实时",
    title: "实时盘口",
    subtitle: "真实现货价格，阈值由当前价推导，收盘时间固定为 UTC",
    source: "CoinGecko 现货",
    updated: "更新于 {{time}}",
    question: "{{asset}} 能否在 {{date}} 前收于 {{price}} 上方？",
    criteria: "CoinGecko {{asset}}/USD 在 {{date}} 00:00 UTC 的日收盘价。",
    spot: "现货 {{price}}",
    distance: "距行权价 {{pct}}%",
    trade: "交易",
    unavailable: "实时价格暂不可用 — 下方目录不受影响。",
  },
} satisfies Messages;
