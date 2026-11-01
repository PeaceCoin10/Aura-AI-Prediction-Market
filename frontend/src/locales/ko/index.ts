import type { Messages } from "../en";

/** Korean (ko-KR) message tree. Mirrors en 1:1. */
export const ko = {
  shell: {
    brand: {
      name: "Aura",
      wordmark: "AURA",
      tagline: "AI 에이전트 예측 마켓",
      descriptor: "AI가 설계한 마켓 · CPMM 가격 결정 · Base 메인넷",
    },
    tabs: {
      feed: "마켓",
      portfolio: "포트폴리오",
      activity: "온체인",
      feedShort: "마켓",
      portfolioShort: "자산",
      activityShort: "이벤트",
    },
    nav: {
      hot: "인기",
      crypto: "크립토",
      news: "뉴스",
      sports: "스포츠",
      esports: "e스포츠",
      tech: "테크",
      other: "기타",
    },
    navHints: {
      hot: "모든 카테고리를 활동량 순으로",
      crypto: "메이저 코인, DeFi, 온체인 자금 흐름",
      news: "국제 뉴스, 지정학, 매크로",
      sports: "NBA · NFL · 프리미어리그 · UCL",
      esports: "LoL · CS2 · VCT",
      tech: "AI, 반도체, 규제",
    },
    mode: {
      real: "실거래",
      paper: "페이퍼",
      realTitle: "실거래 모드 — 지갑을 연결하고 Base에서 USDC로 거래합니다.",
      paperTitle: "페이퍼 모드 — 10,000 FAKE-USDC 무료 지급. 지갑도, 리스크도 없습니다.",
      switchedPaper: "페이퍼 모드가 켜졌습니다",
      switchedPaperBody: "10,000 FAKE-USDC가 지급되었습니다. 오프체인, 리스크 제로 — 전체 거래 흐름을 그대로 연습해 보세요.",
      switchedReal: "실거래 모드가 켜졌습니다",
      switchedRealBody: "지갑을 연결해 Base에서 실제 USDC로 거래하세요. 포지션 규모에 유의하십시오.",
    },
    sound: {
      on: "소리 켜짐 — 클릭하여 음소거",
      off: "음소거됨 — 클릭하여 소리 켜기",
    },
    partners: {
      title: "기관 생태계",
      subtitle: "이 북이 돌아가는 인프라와 협업하는 데스크.",
      close: "닫기",
      liveBadge: "프로덕션 가동 중",
      integrationsTitle: "검증된 연동",
      integrationsBody: "아래 항목은 모두 실제 제품에서 동작합니다. 저장소에 연동이 있는 경우에만 이름을 표기합니다 — 로고 벽도, 암묵적 보증도 없습니다.",
      intBase: "Base",
      intBaseRole: "체인 8453 · 유일한 결제 네트워크",
      intUsdc: "USDC",
      intUsdcRole: "Circle 발행 정식 담보, 6자리",
      intOracle: "CoinGecko",
      intOracleRole: "암호화폐 결제 가격 · 라이브 스트립 현물 시세",
      intTape: "Binance",
      intTapeRole: "주문 흐름 테이프에 쓰는 공개 체결 데이터",
      intSports: "ESPN",
      intSportsRole: "스포츠 마켓의 공식 스코어보드",
      intArt: "Wikimedia Commons",
      intArtRole: "사진 자료, 파일별 출처 표기",
      tracksTitle: "전략 트랙",
      mmTitle: "마켓 메이커",
      mmBody: "상장 북에 깊이를 공급합니다. 공개 주문과 같은 CPMM 곡선으로 체결되며 특별 가격, 별도 수수료, 숨은 재고는 없습니다.",
      mmBullet1: "직접: 지정 마켓 깊이를 공급하고 해당 1.5% 수수료 전액 수취.",
      mmBullet2: "공동: 당사가 설계, 귀사가 자금 공급, 배분은 서면 합의.",
      mmBullet3: "리포트: 마켓별 거래량, 수수료 적립, 상환 익스포저를 매일.",
      oracleTitle: "오라클·데이터 제공자",
      oracleBody: "정산에 쓸 공식 수치 — 종가, 최종 스코어, 규제 결정 — 를 공개하면 피드를 연결하고 마켓 페이지에 출처를 표기합니다.",
      oracleBullet1: "카드와 정산 규칙에 출처명 표기.",
      oracleBullet2: "기계 판독 기준을 귀사와 함께 검토.",
      oracleBullet3: "모든 정산은 사람이 서명하며 뉴스는 자동 정산하지 않습니다.",
      auditTitle: "보안·감사",
      auditBody: "정적 분석과 불변식 테스트는 저장소에 공개되어 있습니다. 제3자 감사는 아직 없으며, 이 페이지는 그렇게 꾸미지 않습니다.",
      auditBullet1: "Slither 0.10.0: High 0, Medium 0, Low 12, Informational 7.",
      auditBullet2: "불변식: 1,000회 × 깊이 100 = 100,000회 호출, 파괴 0.",
      auditBullet3: "계약: 범위, 일정, 공개 조건을 서면 합의.",
      infraTitle: "인프라",
      infraBody: "RPC·인덱싱·모니터링 파트너. 북의 가독성과 정산 관측성을 유지합니다.",
      deskTitle: "기관 데스크",
      deskBody: "양식은 하나, 사람이 분류합니다. 브로슈어가 아니라 서면 회신을 받습니다.",
      formName: "이름",
      formOrg: "소속",
      formKind: "유형",
      formEmail: "업무 이메일",
      formNote: "위임 범위, 내용 또는 연동하려는 것 (선택)",
      formSubmit: "요청 열기",
      formHint: "제출하면 공개 저장소의 미리 채워진 GitHub 이슈가 열립니다. 실제 창구입니다. 다른 곳으로 전송하지 않습니다.",
      formNeed: "이름, 소속, 이메일을 입력하세요.",
      formBadEmail: "이메일 형식이 올바르지 않습니다.",
      formReady: "GitHub 여는 중…",
      kindMm: "마켓 메이커",
      kindOracle: "오라클 / 데이터",
      kindDapp: "거래소 / dApp",
      kindAudit: "감사 / 보안",
      disclaimer: "이 페이지의 이름은 저장소에 실제 존재하는 연동이며, 제휴 발표가 아닙니다.",
    },
    actions: {
      partners: "파트너",
      connect: "지갑 연결",
      disconnect: "연결 해제",
      switchChain: "Base로 전환",
      switchFailed: "네트워크 전환 실패",
      security: "보안",
      securityTitle: "보안 매트릭스: Slither, 불변식, 이의제기 기간",
      docs: "문서",
      docsTitle: "문서: 시작하기, AI 아키텍처, SDK",
      refresh: "새로고침",
      refreshing: "새로고침 중…",
      close: "닫기",
      affiliate: "제휴 · 수수료의 20%",
      search: "마켓, 카테고리, 팀 검색…",
      newMarket: "마켓 개설",
      claimChips: "10,000 칩 받기",
      resetChips: "칩 초기화",
      resetChipsTitle: "페이퍼 잔액을 10,000으로 복구하고 페이퍼 포지션을 초기화합니다",
      connectToView: "지갑을 연결하면 포지션을 볼 수 있습니다",
    },
    status: {
      rpc: "Base RPC",
      rpcDown: "연결 불가",
      brain: "Hermes 브레인",
      heartbeat: "하트비트 정상",
      lastCycle: "마지막 사이클 {{min}}분 전",
      idle: "대기 중 — 지갑에 자금을 넣어 마켓을 개설하세요",
      security: "보안 매트릭스",
      docs: "문서 포털",
    },
    locale: {
      label: "언어",
      active: "KO",
    },
    socials: {
      title: "공식 채널",
      x: "X 팔로우",
      telegram: "텔레그램 참여",
      github: "GitHub 소스",
    },
    footer: {
      engine: "CentralPredictionEngine",
      chain: "Base · 체인 8453",
      fees: "거래 수수료 1.5% / 정산 수수료 0.5%",
      dispute: "1시간 이의제기 기간",
      rights: "오픈소스 · MIT",
    },
    toasts: {
      copied: "클립보드에 복사했습니다",
      copyFailed: "복사에 실패했습니다 — 텍스트를 직접 선택하세요",
    },
  },

  hall: {
    heroTitleA: "AI 예측 마켓",
    heroTitleB: "스스로 오더북을 만들어 내는 브레인과 함께",
    heroBody:
      "Hermes는 크립토, 뉴스, 스포츠, e스포츠 실시간 피드에서 5분마다 마켓을 설계합니다. 가격은 Base의 CPMM(상수곱 마켓 메이커)이 결정하며, 새로고침마다 Multicall3를 1회 읽고 15초 주기로 동작합니다.",
    statsPaper: {
      featured: "추천 마켓",
      cadence: "틱 주기",
      cadenceValue: "7초",
      volume: "시뮬레이션 거래량",
      chain: "온체인 마켓",
    },
    statsReal: {
      chain: "온체인 마켓",
      active: "거래 중",
      liquidity: "풀 유동성",
      featured: "추천 마켓",
    },
    paperBar: {
      label: "페이퍼 트레이딩",
      balance: "잔액",
      hint: "지갑이 필요 없습니다 — 추천 마켓 12개, 실시간 시뮬레이션 틱, AI 코멘트, 토론 월이 모두 가동 중입니다.",
      hintCount:
        "지갑이 필요 없습니다 — 추천 마켓 {{count}}개, 실시간 시뮬레이션 틱, AI 코멘트, 토론 월이 모두 가동 중입니다.",
    },
    sections: {
      featuredTitle: "추천 마켓",
      featuredBadge: "오프체인 · 자유롭게 거래 가능",
      featuredNote: "7초마다 시뮬레이션 틱 · 실제 CPMM 연산으로 산출한 견적",
      chainTitle: "실시간 온체인 마켓",
      chainNote:
        "CentralPredictionEngine은 배포되어 일시정지 상태가 아니지만, 아직 유동성이 공급된 마켓이 없습니다. Hermes 브레인이 마켓을 만들고 유동성을 공급하려면 지갑에 USDC가 있어야 합니다.",
      chainEmptyTitle: "아직 온체인 마켓이 없습니다",
      chainEmptyBody:
        "아래는 모두 추천 마켓입니다. CPMM 연산과 거래 흐름은 동일하지만 로컬에서 정산되므로 몇 초 만에 포지션을 보유할 수 있습니다.",
      demoEmptyTitle: "이 카테고리에는 아직 마켓이 없습니다",
      demoEmptyHint: "인기 탭으로 돌아가거나 다른 카테고리를 선택하세요.",
      refreshFailed: "새로고침에 실패했습니다 — 마지막 정상 스냅샷을 표시합니다:",
    },
    portfolio: {
      title: "포트폴리오",
      subtitle: "포지션은 엔진 내부의 yesOf / noOf 원장(ERC-1155 방식)입니다. redeem()으로 출금하세요.",
    },
    connect: {
      title: "지갑을 연결하세요",
      google: "Google",
      email: "이메일",
      socialNote: "원탭 스마트 계정 — 첫 거래는 가스비가 지원됩니다.",
      body:
        "EIP-6963 탐색으로 MetaMask, Coinbase, Rabby를 비롯한 모든 인젝티드 지갑과 EOA를 지원합니다. 연결하면 Base 메인넷(8453)으로 전환하라는 요청이 표시됩니다.",
      empty:
        "지갑 확장 프로그램을 찾지 못했습니다. MetaMask 또는 Coinbase Wallet을 설치하고 새로고침하거나, 위의 추천 마켓을 페이퍼 칩으로 거래해 보세요.",
      connecting: "연결 중…",
      failed: "연결에 실패했습니다",
    },
    paused:
      "프로토콜이 일시정지되었습니다. 신규 거래는 거부되며, 정산과 이의제기 기간 이후의 출금만 처리됩니다.",
  },

  /**
   * `content` namespace — market copy and data-layer strings.
   *
   * Demo market ids, seed comment authors and stances mirror `en` exactly; only the
   * human-readable text is Korean. Templates use `{{var}}` and are rendered with
   * `format()` from `lib/i18n`.
   */
  content: {
    demoMarkets: {
      "demo-btc-88k": {
        question: "BTC가 24시간 안에 $88,000을 돌파할까요?",
        criteria:
          "정산 시점의 BTC/USD 현물가가 $88,000 이상이면 YES로 정산합니다(CoinGecko 우선, Binance 대체). 그렇지 않으면 NO입니다.",
      },
      "demo-eth-etf": {
        question: "이번 주 현물 ETH ETF에 하루 순유입 $500M를 넘는 날이 있을까요?",
        criteria:
          "정산 시점에 Farside / SoSoValue의 공식 자금 흐름 데이터에서 하루 순유입이 $500M를 넘는 날이 확인되면 YES로 정산합니다.",
      },
      "demo-defi-tvl": {
        question: "전체 DeFi TVL이 48시간 안에 $120B를 회복할까요?",
        criteria: "정산 시점의 전 체인 TVL 스냅샷이 DefiLlama 기준 $120B 이상이면 YES로 정산합니다.",
      },
      "demo-fed-cut": {
        question: "다음 FOMC 성명서에 연준이 금리 인하를 명시할까요?",
        criteria:
          "연방준비제도 웹사이트에 게시된 FOMC 성명서에 금리 인하에 대한 언급이 있으면 YES, 없으면 NO로 정산합니다.",
      },
      "demo-ceasefire": {
        question: "이번 주 최소 두 곳의 주요 언론이 휴전 합의를 보도할까요?",
        criteria:
          "정산 전까지 Reuters, AP, BBC 중 최소 두 곳이 독립적으로 휴전을 보도하면 YES로 정산합니다. 단일 통신 기사를 재게재한 것은 두 번째 언론사로 인정되지 않습니다.",
      },
      "demo-ai-act": {
        question: "EU AI 법 시행 규칙이 이번 달 발효될까요?",
        criteria:
          "규칙 문안이 관보(OJ)에 게시된 경우에만 YES로 정산합니다. 관보 게시 없이 집행위원회 승인만 받은 경우는 NO입니다.",
      },
      "demo-nba-celtics": {
        question: "보스턴 셀틱스가 오늘 밤 NBA 경기에서 브루클린 네츠를 이길까요?",
        criteria:
          "ESPN 공식 최종 점수(연장 포함)로 정산합니다. 셀틱스 승리 → YES, 패배 또는 무승부 → NO, 24시간 초과 연기 → INVALID로 전액 환불됩니다.",
      },
      "demo-epl-derby": {
        question: "아스널이 이번 프리미어리그 라운드에서 첼시를 이길까요?",
        criteria:
          "프리미어리그 공식 최종 점수(추가 시간 포함)로 정산합니다. 아스널 승리 → YES, 무승부 또는 패배 → NO.",
      },
      "demo-nfl-chiefs": {
        question: "캔자스시티 치프스가 원정 경기에서 이길까요?",
        criteria: "NFL 공식 최종 점수로 정산합니다. 치프스 승리 → YES, 무승부 또는 패배 → NO.",
      },
      "demo-lol-t1": {
        question: "T1이 월즈 녹아웃 스테이지에서 Movistar KOI를 이길까요?",
        criteria:
          "LoL Esports 공식 결과(gameWins)로 정산합니다. T1이 시리즈를 가져가면 YES, 아니면 NO입니다.",
      },
      "demo-cs2-major": {
        question: "유럽 지역이 CS2 메이저 그룹 스테이지에서 경기의 60% 이상을 승리할까요?",
        criteria: "HLTV 공식 이벤트 통계 기준, 정산 시점의 유럽 승률이 60%를 넘으면 YES, 아니면 NO입니다.",
      },
      "demo-valorant": {
        question: "Sentinels가 다음 VCT 경기를 2:0으로 이길까요?",
        criteria: "VCT 공식 결과 기준, 정확히 2:0이면 YES, 그 외 스코어는 NO입니다.",
      },
    },
    seedComments: {
      "demo-btc-88k": [
        {
          author: "0xWhale",
          stance: "YES",
          text: "ETF 자금이 계속 쌓이고 있습니다. 88k는 시간문제이고, 24시간이면 충분합니다.",
        },
        {
          author: "Satoshi_Cat",
          stance: "NO",
          text: "86k에 두꺼운 청산 매물벽이 있습니다. 뚫지 못합니다.",
        },
      ],
      "demo-eth-etf": [
        {
          author: "defi_researcher",
          stance: "YES",
          text: "스테이킹 ETF가 승인되면 하루 $500M은 아무것도 아닙니다.",
        },
      ],
      "demo-fed-cut": [
        {
          author: "MacroHound",
          stance: "NO",
          text: "점도표는 여전히 매파적입니다. 성명서에 인하라는 단어는 나오지 않을 겁니다.",
        },
        {
          author: "Bond_Trader",
          stance: "YES",
          text: "물가 지표가 꺾였습니다. 완화적 표현이 나올 확률은 이미 40%입니다.",
        },
      ],
      "demo-nba-celtics": [
        {
          author: "courtside_vet",
          stance: "YES",
          text: "백투백 일정인 팀을 홈에서 만납니다. 접전이 아닙니다.",
        },
      ],
      "demo-lol-t1": [
        {
          author: "RiftAnalyst",
          stance: "YES",
          text: "T1의 밴픽 준비가 더 깊습니다. BO5 경험 차이는 실재합니다.",
        },
        {
          author: "KOI_faithful",
          stance: "NO",
          text: "이번 패치는 KOI의 초반 템포에 유리합니다. 이변이 옵니다.",
        },
      ],
    },
    insights: {
      flavor: {
        crypto: "온체인 자금 흐름",
        news: "뉴스 와이어",
        tech: "테크 내러티브",
        sports: "스포츠 배당판",
        esports: "e스포츠 메타",
        fallback: "시장",
      },
      crowded:
        "YES 확률이 이미 {{prob}}%입니다 — 롱 쪽에 자금이 지나치게 몰렸습니다. 지금 매수하면 기대 배당이 더 이상 유리하지 않으며, 대형 매도 한 건으로 두 자릿수 평가손실이 발생할 수 있습니다.",
      edge:
        "{{prob}}%에서 롱이 근소하게 우위지만, {{flavor}}에서 아직 결정적 신호가 나오지 않았습니다. 한 번에 베팅하기보다 분할 진입하십시오.",
      neutral:
        "확률이 {{prob}}%로 중립 구간의 한가운데에 고정되어 있습니다. 양쪽 모두 새 정보를 기다리는 상황입니다. 유동성 공급자에게 가장 편안한 구간이며, 테이커는 양방향으로 흔들리기 쉽습니다.",
      fade:
        "숏이 근소하게 우위입니다(YES {{prob}}%). 저렴하지만 촉매가 필요한 구조로, 소액의 반전 베팅만이 적절한 보상을 기대할 수 있습니다.",
      priced:
        "YES가 {{prob}}%까지 내려왔습니다 — 시장이 이 결과를 거의 모두 가격에 반영했습니다. {{flavor}}에서 블랙스완급 반전이 나오지 않는다면 남은 기대값은 거의 없습니다.",
      thinPool: " 풀 깊이가 {{depth}} USDC에 불과해 100 USDC만으로도 가격이 움직입니다 — 가격 영향을 감안하십시오.",
      heavyVolume: " 거래량({{vol}} USDC)이 이미 풀 깊이의 {{multiple}}배입니다 — 회전율이 매우 높습니다.",
      closingSoon: " 정산까지 1시간 미만입니다 — 이의제기 기간이 시작되면 출금이 잠깁니다.",
      finalHours: " 정산까지 {{hours}}시간 남았습니다. 마지막 구간에서 변동성이 가장 크게 나타나는 경우가 많습니다.",
      basis: "확률 {{prob}}% · 깊이 {{depth}} USDC · 거래량 {{vol}} USDC",
    },
    eventLabels: {
      MarketCreated: "마켓 개설",
      MarketCategoryUpdated: "카테고리 변경",
      LiquiditySeeded: "유동성 공급",
      SharesBought: "매수 체결",
      SharesSold: "매도 체결",
      MarketResolved: "마켓 정산",
      DisputeWindowOpened: "이의제기 기간 개시",
      ResolutionOverridden: "정산 결과 번복",
      ResolutionFinalized: "정산 확정",
      Redeemed: "상환 지급",
      ResidualSwept: "잔여분 회수",
      FeeVaultUpdated: "수수료 보관소 변경",
      TreasuryUpdated: "재무 보관소 변경",
      CreatorUpdated: "생성자 권한 변경",
      OracleUpdated: "오라클 권한 변경",
      Paused: "프로토콜 일시정지",
      Unpaused: "프로토콜 재개",
      AdminTransferStarted: "관리자 이전 시작",
      AdminTransferred: "관리자 이전 완료",
    },
    /** Feed / toast bodies. `{{var}}` is substituted from decoded event args. */
    eventFeed: {
      createdTitle: "{{label}}: {{question}}",
      createdBody: "카테고리 {{category}} · 정산 {{when}}",
      liquidityBody: "{{amount}} USDC 유동성 공급",
      tradeTitle: "{{label}} · {{outcome}}",
      buyBody: "{{amount}} USDC 지불 → 셰어 {{shares}}개 수령 (수수료 {{fee}})",
      sellBody: "셰어 {{shares}}개 매도 → {{amount}} USDC 수령",
      resolvedTitle: "{{label}}: {{outcome}}",
      resolvedBody: "1시간 이의제기 기간 — Safe가 번복 가능",
      resolvedBodyEmergency: "긴급 환불 경로",
      disputeBody: "이의제기 기간 {{when}}까지 · 기간 중 상환 잠김",
      overrideTitle: "{{label}}: {{from}} → {{to}}",
      overrideBody: "결과 번복 {{count}}회",
      redeemedBody: "지급액 {{payout}} USDC (소각 YES {{yes}} / NO {{no}})",
      pausedBody: "거래 및 상환 일시정지 (긴급 출금 기간은 예외)",
    },
    outcomes: {
      yesWins: "YES 승리",
      noWins: "NO 승리",
      invalid: "무효 (셰어당 0.5 지급)",
    },
    phase: {
      trading: "거래 중",
      awaiting: "정산 대기",
      disputing: "이의제기 기간",
      final: "확정",
      closed: "종료",
      empty: "없음",
    },
    paper: {
      amountPositive: "금액은 0보다 커야 합니다",
      insufficientBalance: "페이퍼 잔액이 부족합니다 — 먼저 10,000 FAKE-USDC를 받으세요",
      noShares: "이 금액으로는 셰어를 살 수 없습니다 — 풀이 너무 얕거나 금액이 너무 작습니다",
      noPosition: "이 마켓에 페이퍼 포지션이 없습니다",
      exceedsPosition: "매도 수량이 포지션을 초과합니다",
      depthTooThin: "현재 깊이로는 이 매도를 소화할 수 없습니다",
    },
    wallet: {
      noProvider: "지갑 확장 프로그램을 찾지 못했습니다 — MetaMask 또는 Coinbase Wallet을 설치하세요",
      noAccounts: "지갑이 계정을 반환하지 않았습니다",
      notConnected: "지갑이 연결되지 않았습니다",
      fallbackName: "브라우저 지갑",
      hookOutsideProvider: "useWallet은 <WalletProvider> 안에서만 사용해야 합니다",
    },
    mode: {
      hookOutsideProvider: "useMode는 <ModeProvider> 안에서만 사용해야 합니다",
    },
    format: {
      expired: "만료됨",
      unknownError: "알 수 없는 오류",
      dayUnit: "일",
    },
    slippage: {
      conservative: "보수적",
      default: "기본",
      aggressive: "공격적",
    },
    poster: {
      tagline: "에이전트 DeFi · AI 예측 마켓",
      modePaper: "페이퍼",
      modeReal: "실거래",
      sideNeutral: "관망",
      sideBet: "{{side}} 베팅",
      probLabel: "현재 YES 확률",
      returnLabel: "예상 수익",
      scanQr: "QR을 스캔하여 마켓 열기",
      footer: "Base 메인넷 · 컨트랙트 검증 완료 · 1시간 이의제기 기간 · 거래 수수료 1.5%",
      canvasUnavailable: "캔버스를 사용할 수 없습니다",
      tweetLeadNeutral: "관망 중",
      tweetLeadBet: "{{side}} 베팅 중",
      tweet: '{{lead}} "{{question}}" | YES {{prob}}%{{potential}} #AIPredictionMarkets #Base #Aura',
      tweetPotential: ", 예상 수익 {{ret}}",
    },
  },

  /**
   * `security` namespace — the first-run risk disclosure, the security matrix drawer
   * and the docs portal.
   *
   * Compliance surface: wording stays literal and every figure mirrors `en` exactly —
   * never round or restate them as ranges. Templates use `{{var}}` and are rendered
   * with `format()` from `lib/i18n`.
   */
  security: {
    common: {
      close: "닫기",
    },
    risk: {
      title: "위험 고지 및 이용약관",
      bulletProtocol:
        "Aura는 탈중앙화 예측 마켓 프로토콜입니다. 투자 자문을 제공하지 않으며, 이곳의 어떤 내용도 투자 권유로 해석될 수 없습니다.",
      bulletPrice:
        "셰어 가격은 AMM 곡선으로 결정되며 0까지 하락할 수 있습니다. 잃어도 감당할 수 있는 USDC만 투입하십시오.",
      bulletDispute:
        "정산에는 1시간의 이의제기 기간이 적용됩니다. 해당 기간에는 출금이 중단되며, Safe 멀티시그가 그 안에서 결과를 번복할 수 있습니다.",
      bulletPaper:
        "페이퍼 모드는 로컬 가상 칩으로 동작합니다. 실제 자산은 전혀 개입되지 않으며 칩은 상환할 수 없습니다.",
      bulletAudit:
        "컨트랙트는 오픈소스이며 Base 메인넷에서 검증되었지만, 어떤 감사도 리스크가 0임을 보장하지는 않습니다.",
      consent:
        "계속 진행하면 본 약관을 읽고 동의하였으며, 거주 지역에서 이러한 상품 참여가 허용됨을 확인하는 것으로 간주됩니다.",
      ack: "위험을 이해했습니다 — 마켓 입장",
    },
    drawer: {
      title: "보안 매트릭스",
      slither: {
        title: "정적 분석 · Slither",
        high: "높음",
        medium: "중간",
        low: "낮음",
      },
      tests: {
        title: "테스트 매트릭스",
        forgeLead: "forge test — ",
        forgeTail: "개 테스트 통과 (유닛 + 불변식)",
        invariantLead: "불변식 테스트: ",
        invariantRunsDepth: "회 실행 × 깊이 ",
        invariantCallsLead: ", ",
        invariantTail:
          "회 핸들러 호출 실행 (셀렉터 8개당 약 12,800회), revert 0회, 불변식 위반 0회",
        coverage: "SDK: 오프라인 케이스 70/70 · 프론트엔드: 라이브체인 e2e 11/11 + UI e2e 55/55",
      },
      economics: {
        title: "경제 및 거버넌스 통제",
        feeLead: "수수료: ",
        feeTail: " — 전액이 ProtocolFeeVault로 귀속되며, 출금에는 Safe 서명이 필요합니다",
        disputeLead: "이의제기 기간: ",
        disputeTail: " — 마켓 정산 즉시 시작되며, 기간 동안 출금은 계속 중단됩니다",
        overrideLead: "번복 권한: ",
        emergencyLead: "긴급: ",
        emergencyWindow: "7일",
        emergencyMid: "이 지난 뒤 누구나 호출할 수 있습니다: ",
        emergencyTail: " — 전액 환불",
      },
      verified: {
        title: "검증된 컨트랙트 (Base 메인넷)",
        badge: "✓ 검증 완료",
      },
    },
    docs: {
      title: "문서 포털",
      tabs: {
        start: "시작하기",
        brain: "Hermes AI 아키텍처",
        sdk: "SDK 연동",
      },

      start: {
        headingPaper: "3초 만에 포지션까지 (지갑 불필요)",
        paperSteps: [
          "우측 상단 토글을 페이퍼로 전환 → 10,000 칩 받기.",
          "홀에서 아무 마켓이나 선택해 YES 또는 NO를 매수하세요 — 셰어 수량, 평균 가격, 가격 영향이 실시간으로 계산됩니다.",
          "포지션 패널에서 미실현 PnL을 실시간으로 확인할 수 있고, 매도하면 곧바로 잔액으로 정산됩니다.",
        ],
        headingReal: "실거래",
        realSteps: [
          "실거래로 전환 → 지갑 연결 (Base, 체인 8453으로 전환됩니다).",
          "마켓 선택 → USDC 금액 입력 → 첫 거래에는 approve가 필요하며 패널이 알아서 처리합니다.",
          "토스트에 트랜잭션 해시가 표시되며, Basescan에서 확인할 수 있습니다.",
          "마켓이 정산되면 1시간의 이의제기 기간에 들어가고, 기간이 끝나면 상환이 열립니다.",
        ],
        headingFees: "수수료와 정산",
        feesBody:
          "거래에는 1.5%, 정산 지급에는 0.5%가 부과됩니다. 가격 = NO 리저브 / 총 리저브이며, 단일 거래는 풀 깊이의 5%로 하드 캡이 적용됩니다.",
      },

      brain: {
        headingEngines: "세 개의 엔진, 하나의 루프",
        creator: "크리에이터",
        creatorBody:
          ": 여러 거래소 데이터 수집(CoinGecko/Binance, RSS 뉴스, ESPN 스코어보드, LoL Esports) → YES/NO 이진 질문 생성 → 마켓 메이킹 유동성과 함께 마켓 개설",
        oracle: "오라클",
        oracleBody:
          ": 가격 마켓은 윅(wick)에 견디도록 30초 간격 3회 다중 샘플로 읽고, 스포츠와 e스포츠는 공식 결과로만 정산하며, 뉴스 마켓은 자동 정산하지 않고 Safe 또는 수동 호출을 기다립니다",
        marketing: "마케팅",
        marketingBody:
          ": 신규 마켓마다 템플릿 엔진으로 Twitter / Telegram 문안을 생성하며, 선택적으로 LLM 처리를 거칩니다",
        headingConstraints: "질문 작성 규칙",
        constraintsBody:
          "이진 형태(될까/안 될까), 정산 시점은 30분에서 8일 이내, 그리고 객관적 정산 기준이 필요합니다. 그 밖의 마켓은 모두 폐기됩니다.",
        headingCommentary: "코멘터리",
        commentaryLead: "브레인은 매 사이클마다 실제 마켓에 대한 코멘터리를 다음 위치에 기록합니다 ",
        commentaryTail:
          "; 프론트엔드는 60초마다 폴링합니다. 브레인이 오프라인이면 프론트엔드가 규칙 엔진으로 대체하고 결과에 '로컬 추론'이라고 표시합니다.",
      },

      sdk: {
        headingInstall: "설치 및 연결",
        headingRead: "마켓 읽기 (Multicall3 1회)",
        headingOrder: "주문 실행",
        footnote:
          "오프라인 견적은 SDK에 previewBuyOffline / previewSellOffline으로 포함되어 있으며, 온체인 previewBuy와 wei 단위까지 일치합니다. decodeLogs는 원시 이벤트를 구조화된 알림으로 변환합니다.",
      },
    },
  },

  /**
   * `trade` namespace — on-chain market detail and the real trading panel.
   *
   * Korean copy keeps venue vocabulary (풀 깊이, 가격 영향, 슬리피지, CPMM) over consumer
   * phrasing. Fees and windows are contract facts and mirror `en` exactly. Templates
   * use `{{var}}` and are rendered with `format()` from `lib/i18n`.
   */
  trade: {
    common: {
      close: "닫기",
    },

    market: {
      onChainChip: "온체인 마켓",
      settlesPrefix: "정산 ",
      inPrefix: "정산까지 ",
      untitled: "제목 없는 마켓",
      shareFallbackQuestion: "AI 예측 마켓",
      dataTitle: "마켓 데이터 (온체인 직접 조회)",
      yesProb: "YES 확률",
      noProb: "NO 확률",
      yesReserve: "YES 리저브",
      noReserve: "NO 리저브",
      cash: "풀 현금",
      owed: "총 지급 예정",
      volume: "누적 거래량",
      tradable: "거래 가능",
      yes: "예",
      no: "아니오",
      status: "정산 상태",
      statusFinalized: "확정",
      statusDispute: "이의제기 중",
      statusUnresolved: "미정산",
      outcome: "결과",
      rulesTitle: "규칙",
      rulePricing:
        "가격 = NO 리저브 / 총 리저브. 거래는 CPMM을 통해 이루어지며, 단일 주문은 풀 깊이의 5%로 하드 캡이 적용됩니다.",
      ruleFees: "거래 금액에서 1.5%, 정산 지급액에서 0.5%의 수수료가 부과됩니다.",
      ruleDispute:
        "정산이 시작되면 1시간의 이의제기 기간이 열립니다. Safe(관리자)가 결과를 번복할 수 있으며, 그동안 출금은 중단됩니다.",
      ruleEmergency:
        "마켓이 정산 시점으로부터 7일이 지나도 미정산 상태라면 누구나 emergencyRefund를 호출해 전액 환불받을 수 있습니다.",
    },

    panel: {
      poolDepth: "풀 깊이",
      disputeLeft: "이의제기 종료까지",
      settlesIn: "정산까지",
      finalized: "확정됨",
      awaitingFinalize: "확정 대기",

      disputeTitle:
        "1시간 이의제기 기간입니다. Safe가 여전히 결과를 번복할 수 있으며, 출금은 중단된 상태입니다.",
      disputeBodyLead: "이의제기 기간이 ",
      disputeBodyMid: " 후 종료되며 자동으로 확정됩니다 — 누구나 ",
      disputeBodyTail: "를 호출해 확정 이벤트를 기록할 수 있습니다.",

      position: "내 포지션",
      redeemTitleClosed: "이의제기 기간에는 출금할 수 없습니다",
      redeemDispute: "이의제기 중 출금 중단",
      redeemReady: "상금 상환",
      redeemEmpty: "상환 가능한 포지션 없음",
      redeemNote:
        "정산 수수료 0.5%. INVALID 마켓은 YES와 NO 셰어당 각각 0.5 USDC를 지급합니다. 프로토콜이 일시정지된 동안에는 정산 시점으로부터 7일 후 강제 출금이 열립니다.",

      buyShares: "셰어 매수",
      sellShares: "셰어 매도",
      amountInLabel: "투입 USDC",
      sellLabel: "매도할 셰어",
      sellable: " (최대 {{amount}})",
      unitUsdc: "USDC",
      unitShares: "셰어",
      max: "최대",

      slippage: "슬리피지",
      capHint: "건당 한도 ≈ {{amount}} USDC (깊이의 5%)",

      quoteReceive: "수령 예상",
      quoteReturn: "반환 예상",
      quoteChain: "· 온체인 견적",
      quoteOffline: "· 오프라인 추정치",
      unitSharesSuffix: " 셰어",
      avgFill: "평균 체결가",
      pricePerShare: "USDC/셰어",
      priceImpact: "가격 영향",
      impactCap: " / 5% 한도",
      tradingFee: "거래 수수료",
      feeOnChain: " (온체인에서 차감)",
      protectedPrice: "보호 가격",
      protectedPriceValue: "{{amount}} (-{{slip}})",
      impactWarnLead: "가격 영향이 한도의 80%입니다 (SDK 경고 ",
      impactWarnMid: "). 더 큰 주문은 다음에서 거부됩니다: ",
      impactWarnTail: " — 수량을 줄이거나 주문을 분할하십시오.",

      submitSettled: "마켓 정산 완료",
      submitClosed: "거래 종료",
      buy: "{{side}} 매수",
      sell: "{{side}} 매도",
      connectToTrade: "지갑을 연결하고 거래하세요",

      confirmTitle: "가격 영향이 하드 캡에 근접했습니다",
      confirmBodyLead: "SDK가 다음 값을 반환했습니다: ",
      confirmBodyMid: " — 이 주문은 풀 깊이의 ",
      confirmBodyTail:
        "%를 소모합니다(컨트랙트 한도 5%). 체결 조건이 크게 불리해지고 실제 자금이 이동합니다.",
      confirmReduce: "수량 줄이기",
      confirmProceed: "그대로 실행",

      footerUsdc: "USDC",
      footerEngine: "엔진",
      footerNote: "온체인 정산, 되돌릴 수 없음",
    },

    toasts: {
      allowanceChecking: "USDC 승인 한도 확인 중",
      allowanceBody: "spender = CentralPredictionEngine",
      submitted: "트랜잭션을 전송했습니다. 확정을 기다리는 중…",
      reverted: "트랜잭션이 revert되었습니다 (status = reverted)",
      confirmedEvent: "온체인 확정: {{event}}",
      confirmed: "온체인 확정",
      tradeFailed: "거래 실패",
      connectFirst: "먼저 지갑을 연결하세요",
      amountRequired: "금액을 입력하세요",
      redeemSubmitted: "상환 요청 제출됨",
      redeemConfirmed: "상환 확정",
      redeemFailed: "상환 실패",
    },
  },

  paper: {
    card: {
      held: "보유",
      yesProbability: "YES 확률",
      noProbability: "NO 확률",
      tickTitle: "배당률 7초마다 갱신",
      depth: "깊이 {{amount}} USDC",
      settlePrefix: "정산 ",
      expired: "만료됨",
      volume: "거래량 {{amount}} USDC",
      debate: "💬 토론 {{count}}",
      aiTag: "◈ AI",
      paperValue: "페이퍼 가치 {{amount}} FAKE",
      sample: "샘플",
      tickNote: "7초 주기 · 페이퍼 체결",
      byAuthor: "— {{author}}",
    },
    detail: {
      offchainBadge: "오프체인 마켓 · 페이퍼 정산",
      settledAt: "정산 {{time}}",
      remainingPrefix: "정산까지 ",
      close: "닫기",
      bookTitle: "마켓 데이터",
      yesProbability: "YES 확률",
      noProbability: "NO 확률",
      yesReserve: "YES 리저브",
      noReserve: "NO 리저브",
      volume: "누적 거래량",
      source: "데이터 출처",
      mathNote:
        "확률은 CPMM이 산출한 가격이며, 프론트엔드가 7초마다 호가를 미세하게 움직이고 이를 시뮬레이션으로 표시합니다.",
      criteriaTitle: "정산 기준",
    },
    panel: {
      badge: "페이퍼 모드",
      balance: "잔액 {{amount}} FAKE-USDC",
      claim: "10,000 칩 받기",
      reset: "초기화",
      resetTitle: "페이퍼 계정 초기화",
      resetBody: "칩이 10,000 FAKE-USDC로 복구되었습니다",
      buyYes: "YES · {{prob}}",
      buyNo: "NO · {{prob}}",
      amountLabel: "금액 (FAKE-USDC)",
      amountPlaceholder: "0.00",
      max: "최대",
      slippage: "슬리피지",
      estShares: "예상 셰어",
      avgPrice: "평균 가격",
      marginalPrice: "한계 가격",
      minReceived: "최소 수령 (슬리피지 보호)",
      impact: "가격 영향",
      impactWarning:
        "⚠ 경고: impact_near_limit — 가격 영향 {{impact}}, 컨트랙트 한도 5%에 근접했습니다. 주문을 분할하면 비용이 줄어듭니다.",
      buy: "{{side}} 매수",
      sell: "{{side}} 매도 ({{shares}})",
      insufficientChips: "칩이 부족합니다 (잔액 {{amount}}). 먼저 받기 또는 초기화를 진행하세요.",
      boardTitle: "페이퍼 포지션 · PnL",
      boardEmpty: "아직 페이퍼 포지션이 없습니다 — 다음 체결이 여기에 표시됩니다.",
      yesShares: "YES 셰어",
      noShares: "NO 셰어",
      invested: "총 투입",
      markValue: "평가 가치 (현금화 기준)",
      disclaimer:
        "페이퍼 모드: 실제 CPMM 연산, 로컬 칩. 오프체인이며 출금 불가, 실제 자산은 개입되지 않습니다.",
      errorTitleBuy: "페이퍼 주문 실패",
      errorTitleSell: "페이퍼 매도 실패",
      toastBuyTitle: "페이퍼 {{side}} 매수 체결",
      toastBuyBody: "{{amount}} FAKE-USDC → 셰어 {{shares}}개 · 평균 ${{price}} · 오프체인, 비용 없음",
      toastSellTitle: "페이퍼 {{side}} 매도 체결",
      toastSellBody: "셰어 {{shares}}개 → 잔액으로 {{proceeds}} FAKE-USDC 반환",
    },
    account: {
      title: "페이퍼 계정",
      badge: "페이퍼 트레이딩",
      summary: "잔액 {{balance}} FAKE-USDC · 포지션 가치 {{value}}",
      unrealized: "미실현",
      claim: "10,000 칩 받기",
      reset: "페이퍼 계정 초기화",
      empty:
        "아직 페이퍼 포지션이 없습니다. 홀의 아무 마켓에서 주문해 보세요 — 평가 가치와 PnL이 이곳에 실시간으로 표시되며, 모두 로컬에서 정산되고 비용은 없습니다.",
      rowMeta: "YES {{yes}} / NO {{no}} · 투입 {{spent}} · 가치 {{value}}",
      footnote:
        "페이퍼 모드는 실제 CPMM 곡선을 로컬에서 정산합니다. 칩은 출금과 양도가 불가하며, 실제 USDC를 다루는 것은 실거래 모드뿐입니다.",
    },
  },

  portfolio: {
    positions: {
      title: "포지션",
      connectTitle: "지갑을 연결하면 포지션을 볼 수 있습니다",
      connectHint:
        "포지션은 엔진의 온체인 ERC-1155 원장(yesOf / noOf)에 있습니다. 로컬에 캐시되는 값은 없습니다.",
      usdcBalance: "USDC 잔액",
      unsettled: "미정산 (셰어)",
      sharesUnit: "셰어",
      redeemable: "상환 가능 마켓",
      marketsUnit: "개 마켓",
      disputingUnit: "· 이의제기 {{count}}건",
      disputeTitle: "{{count}}개 마켓이 1시간 이의제기 기간에 있습니다",
      disputeTitlePlural: "{{count}}개 마켓이 1시간 이의제기 기간에 있습니다",
      disputeBody:
        "1시간 이의제기 기간에는 Safe가 결과를 번복할 수 있어 출금이 잠깁니다. 카운트다운이 끝나거나 누군가 다음을 호출하면 상환이 열립니다:",
      readingShares: "sharesOf 읽는 중…",
      emptyTitle: "아직 포지션이 없습니다",
      emptyHint: "홀에서 마켓을 골라 YES / NO를 매수하세요 — 체결은 곧바로 온체인에 기록됩니다.",
      groupRedeemable: "상환 가능",
      groupDisputing: "이의제기 중",
      groupOpen: "진행 중",
      untitled: "(제목 없는 마켓)",
      yesPrice: "YES {{price}}",
      settles: "정산 {{time}}",
      disputeLabel: "이의제기",
      redeem: "상환",
      locked: "잠김",
      lockedTitle: "이의제기 기간에는 상환할 수 없습니다",
      trade: "거래",
    },
    activity: {
      title: "온체인 이벤트 피드",
      subtitle: "SDK decodeLogs가 원시 로그를 파싱 · 8초마다 증분 eth_getLogs",
      error: "로그 조회 실패: {{error}}",
      emptyTitle: "아직 수집된 이벤트가 없습니다",
      emptyHint:
        "배포 이후 마켓 개설이나 체결이 없었다면 로그가 비어 있습니다. 첫 createMarket / SharesBought 이벤트가 여기에 실시간으로 표시됩니다.",
      txLink: "트랜잭션 보기 →",
      decodeTitle: "decodeLog(args)",
    },
    create: {
      open: "+ 마켓 개설",
      title: "마켓 개설",
      subtitle:
        "marketId = keccak256(question|category|timestamp). CREATOR 역할이 필요하며, 온체인에 기록되면 변경할 수 없습니다.",
      questionLabel: "질문 (8–280 바이트)",
      questionPlaceholder: "예: BTC가 24시간 안에 $81,000을 돌파할까요?",
      categoryLabel: "카테고리",
      hoursLabel: "정산 기한 (시간)",
      seedLabel: "초기 유동성 (USDC, 선택)",
      cancel: "취소",
      submit: "개설",
      noWallet: "먼저 지갑을 연결하세요",
      submittedTitle: "마켓 개설 요청 제출됨",
      seededTitle: "유동성 공급 요청 제출됨",
      seededBody: "{{amount}} USDC 공급",
      liveTitle: "마켓이 활성화되었습니다",
      failedTitle: "마켓 개설 실패",
    },
  },

  marketing: {
    board: {
      title: "상위 예측가",
      badge: "시뮬레이션 집단",
      season: "샘플 북 · 거래량 {{volume}}k",
      colPredictor: "예측가",
      colTrades: "거래",
      colHit: "적중",
      colPnl: "PnL (가상)",
      footnote:
        "실제 계정이 아닌 샘플 북 기준 순위입니다. 활성 지갑 0개, 배포 이후 온체인 체결 {{fills}}건. 모든 수치는 시뮬레이션된 FAKE-USDC입니다.",
    },
    ticker: {
      title: "주문 흐름",
      sample: "샘플 스트림",
      live: "실시간",
      hint: "바이낸스 현물 · 실제 체결",
    },
    spotlight: {
      eyebrow: "AI 데스크 · 스포트라이트",
      title: "255개 마켓. 5개 카테고리. 하나의 곡선.",
      markets: "{{count}}개 마켓",
      volume: "{{amount}} USDC 거래량",
      body: "정치, 크립토, 스포츠, e스포츠, 최첨단 테크 — Base에서 정산되는 동일한 CPMM(상수곱 마켓 메이커)이 가격을 결정합니다.",
      cta: "전체 마켓 둘러보기",
    },
    pool: {
      eyebrow: "초보자 풀 · 시즌 1",
      title: "상금 풀에 참여했습니다",
      body: "모든 신규 예측가가 동일한 25,000 FAKE-USDC 풀에 참여합니다. 포지션을 잡을 때마다 지분이 늘어나며, 로컬에서 정산되고 실제 자금은 쓰이지 않습니다.",
      share: "내 지분",
      joined: "이번 시즌 {{count}}명 참여",
      cta: "예측 시작하기",
      footnote: "시뮬레이션 풀입니다. 칩은 로컬에만 존재하며 출금할 수 없고 금전적 가치가 없습니다.",
    },
  },

  social: {
    card: {
      simPosition: "시뮬레이션 포지션",
      untitled: "제목 없는 마켓",
      settled: "정산 완료",
      yesChance: "YES 확률",
      noChance: "NO 확률",
      liquidity: "유동성 {{amount}}",
      volume: "거래량 {{amount}}",
      position: "내 포지션 · YES {{yes}} / NO {{no}}",
      paperValue: "페이퍼 가치 {{amount}}",
      closesPrefix: "마감까지 ",
      disputePrefix: "이의제기 ",
      disputeNotice: "1시간 이의제기 기간 — Safe가 결과를 번복할 수 있습니다. 출금 중단.",
      shareFallbackQuestion: "AI 예측 마켓",
      loading: "Multicall3로 온체인 마켓을 불러오는 중…",
      errorTitle: "온체인 데이터를 읽지 못했습니다",
      emptyTitle: "이 섹터에는 아직 온체인 마켓이 없습니다",
      emptyHint:
        "Hermes 브레인이 마켓을 개설하고 유동성을 공급하려면 자금이 있는 지갑에 USDC가 필요합니다. 아래 추천 데모 마켓은 지금 페이퍼 칩으로 전체 주문 흐름을 체험할 수 있습니다.",
    },
    debate: {
      title: "토론 월 · {{count}}개",
      subtitle: "진영을 골라 의견을 올리면 반대편이 답합니다.",
      synced: "클라우드 동기화됨",
      sortNew: "최신",
      sortTop: "인기",
      like: "추천",
      likes: "{{count}}",
      post: "의견 게시",
      placeholder: "근거를 적으세요 — 데이터, 촉매, 혹은 틀렸다고 보는 숫자.",
      author: "표시 이름",
      empty: "아직 의견이 없습니다. 첫 발언을 남기세요.",
      stanceYes: "강세 YES",
      stanceNo: "약세 NO",
      stanceNeutral: "중립",
      yesShare: "{{pct}}% 강세",
      needText: "한 문장 이상 작성하세요.",
      posted: "게시됨",
      topHint: "커뮤니티 추천 순",
    },
    comments: {
      title: "토론 월 · {{count}}개 의견",
      localOnly: "이 브라우저에 저장됨",
      yesWins: "YES 승리",
      noWins: "NO 승리",
      neutral: "중립",
      neutralTally: "중립 {{count}}",
      stanceWins: "{{side}} 승리",
      nickname: "닉네임 (선택)",
      placeholder: "입장을 밝혀 주세요 — YES 또는 NO가 이기는 이유는?",
      counter: "{{count}}/500 · 불법 콘텐츠 금지",
      submit: "등록",
      empty: "아직 의견이 없습니다 — 첫 번째가 되어 보세요.",
      official: "공식 주제",
      delete: "삭제",
      secondsAgo: "{{n}}초 전",
      minutesAgo: "{{n}}분 전",
      hoursAgo: "{{n}}시간 전",
      daysAgo: "{{n}}일 전",
    },
    ai: {
      desk: "Hermes AI 데스크",
      tone: {
        bull: "강세",
        bear: "약세",
        warn: "리스크",
        geek: "퀀트",
        calm: "중립",
      },
      live: "브레인 실시간",
      local: "로컬 모델",
      updated: "{{time}} 업데이트",
      basisFallback: "온체인 풀 깊이와 뉴스 흐름",
      disclaimerBrain:
        "공개 데이터를 규칙과 브레인이 작성했습니다. 투자 자문이 아닙니다. 출처: Hermes 브레인 사이클.",
      disclaimerLocal:
        "공개 데이터를 규칙과 브레인이 작성했습니다. 투자 자문이 아닙니다. 출처: 프론트엔드 규칙 엔진, 브레인 오프라인.",
    },
    share: {
      deepLink: "딥링크",
      copied: "복사됨",
      shareIn: "텔레그램에서 공유",
      shareSheet: "텔레그램 공유 시트 열기",
      template: "Aura에서 거래하기 → #PredictionMarkets #Base #AI",
      label: "공유",
      tooltip: "X 공유 카드 생성",
      generating: "생성 중…",
      heading: "공유 카드",
      geometry: "1200×630 · 초대 QR 포함",
      close: "닫기",
      alt: "공유 카드",
      download: "PNG 다운로드",
      postOnX: "X에 게시",
      copyText: "게시 문구 복사",
      failed: "카드 생성 실패: {{err}}",
    },
  },

  airdrop: {
    eyebrow: "에어드롭 · 페이퍼 트레이딩",
    headline: "웰컴 보너스",
    body: "지갑도 USDC도 필요 없습니다. 접속하는 순간 10,000 FAKE-USDC 페이퍼 칩이 자동으로 지급되었습니다.",
    chipsUnit: "FAKE-USDC · 페이퍼 칩",
    credited: "지급 완료 · 언제든 초기화 가능",
    badges: {
      marketsValue: "12",
      markets: "추천 마켓",
      quotesValue: "CPMM",
      quotes: "견적",
      aiValue: "◈",
      ai: "AI 코멘트",
    },
    ctaBalance: "거래 시작 · 잔액 {{balance}} FAKE",
    finePrintPaper:
      "페이퍼 모드입니다. 시뮬레이션 자금만 사용하며 실제 자산은 전혀 개입되지 않습니다. 우측 상단에서 언제든 실거래로 전환할 수 있습니다.",
    finePrintReal:
      "실거래 모드입니다. 페이퍼 칩은 그대로 보관되며, 다시 전환하면 바로 사용할 수 있습니다.",
  },

  ui: {
    countdown: {
      expired: "만료됨",
    },
    loader: {
      connecting: "Base 메인넷에 연결 중…",
    },
    wordmark: {
      subtitle: "AI 예측 마켓 · Base",
    },
    toast: {
      explorerLink: "Basescan에서 보기 →",
    },
    empty: {
      fallbackTitle: "아직 내용이 없습니다",
    },
  },
  terminal: {
    locale: {
      label: "언어",
      hint: "인터페이스 언어",
      current: "현재 언어",
      saved: "언어 설정이 저장되었습니다",
    },
    hero: {
      eyebrow: "글로벌 헤드라인",
      title: "세계가 내일의 가격을 매기는 곳",
      body: "지정학, 중앙은행, 첨단 기술, e스포츠, 대중문화를 아우르는 실시간 확률.",
      previous: "이전 기사",
      next: "다음 기사",
      pause: "자동 넘김 중지",
      play: "자동 넘김 재개",
      slide: "{{index}} / {{total}}",
      probability: "YES",
      move: "지난 1시간 {{delta}}",
      cta: "마켓 열기",
      depth: "유동성 {{amount}} USDC",
      settling: "{{hours}}시간 후 정산",
    },
    whale: {
      title: "고래 자금 흐름",
      hint: "$25k 이상 대형 주문 · 바이낸스 현물",
      sample: "시뮬레이션 테이프",
      live: "온체인 테이프",
      bought: "매수",
      sold: "매도",
      ago: "{{mins}}분 전",
      justNow: "방금",
      note: "실제 거래소 체결이며 이 플랫폼의 체결이 아닙니다",
    },
    depth: {
      title: "실시간 호가 깊이",
      yes: "YES 호가",
      no: "NO 호가",
      price: "중간 가격",
      sweep: "{{amount}} 체결가",
      capacity: "깊이",
      unit: "USDC",
      levels: "{{count}} 단계",
      axis: "가격",
    },
    sync: {
      title: "클라우드 동기화",
      local: "이 기기에서만",
      ready: "동기화 대기",
      syncing: "동기화 중",
      synced: "동기화됨",
      error: "동기화 실패",
      connectWallet: "지갑을 연결하면 자동 동기화",
      body: "페이퍼 잔액, 포지션, 체결 내역, 추천 원장, 토론장 글이 지갑에 묶여 기기 간에 동기화됩니다. 브라우저를 떠나기 전에 서명에서 파생한 키로 AES-GCM 암호화됩니다.",
      lastSync: "마지막 동기화 {{time}}",
      push: "지금 전송",
      pull: "지금 가져오기",
      device: "이 기기",
      cipher: "AES-GCM · 지갑 파생 키",
      provider: "경로",
    },
  },

  affiliate: {
    eyebrow: "제휴",
    title: "프로토콜 수수료의 20%를 받으세요",
    body: "링크를 공유하세요. 링크로 귀속된 모든 거래는 1.5% 거래 수수료의 20%를 프로토콜 몫에서 바로 지급합니다.",
    close: "닫기",
    closeAria: "제휴 패널 닫기",
    inviteLabel: "초대 링크",
    copy: "링크 복사",
    copyTg: "텔레그램 링크 복사",
    copied: "복사됨",
    share: "공유",
    shareText: "Base에서 AI가 작성한 예측 마켓을 거래하세요 — 255개 마켓 운영 중",
    connectHint: "지갑을 연결하면 개인 링크가 발급됩니다. 연결 전에는 주소 자리가 비어 있습니다.",
    invites: "초대 열람",
    volume: "귀속 거래량",
    rebate: "예상 리베이트 (USDC)",
    onchain: "온체인 잔액",
    pool: "풀 {{amount}} USDC",
    ledgerMissing: "원장 미배포",
    claim: "수령",
    claiming: "수령 중…",
    claimed: "리베이트를 수령했습니다 — USDC가 지갑에 입금되었습니다.",
    claimFailed: "수령에 실패했습니다.",
    poolTopping: "리베이트 풀을 채우는 중입니다 — 잔액을 충당하는 즉시 수령이 정산됩니다.",
    arrived: "{{addr}}을 통해 유입되었습니다. 이 주소는 실제 주문에 calldata 메타데이터로 함께 전송됩니다.",
    noReferrer: "이 브라우저에서는 아직 추천인이 기록되지 않았습니다.",
    noteReady: "위의 초대 수와 거래량은 이 기기에만 저장됩니다. 온체인 잔액은 ReferralLedger가 정산합니다.",
    noteLocal: "위의 초대 수와 거래량은 이 기기에만 저장됩니다. ReferralLedger 배포 및 VITE_REFERRAL_LEDGER 설정 후 온체인 지급이 활성화됩니다.",
  },

  live: {
    badge: "실시간",
    title: "실시간 마켓",
    subtitle: "실제 현물 가격을 기준으로 현재가에서 임계값을 계산하고 UTC 고정 시각에 마감합니다",
    source: "CoinGecko 현물",
    updated: "{{time}} 갱신",
    question: "{{asset}}이(가) {{date}}까지 {{price}} 위로 마감할까요?",
    criteria: "{{date}} 00:00 UTC 기준 CoinGecko {{asset}}/USD 일봉 종가.",
    spot: "현물 {{price}}",
    distance: "행사가까지 {{pct}}%",
    trade: "거래",
    unavailable: "실시간 가격을 불러올 수 없습니다 — 아래 카탈로그는 그대로입니다.",
  },
} satisfies Messages;
