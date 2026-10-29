# Aura 品牌与视觉识别（VI）规范

> 一份矢量，三处复用：导航栏 / favicon / 分享海报。代码是唯一事实来源：`frontend/src/components/BrandLogo.tsx`。

---

## 1. 标识语义

| 元素 | 含义 | 实现 |
| --- | --- | --- |
| 六边护盾 | 链上矩阵 / 合约容器 | `LOGO_PATHS.shield` |
| 眼形轮廓 | 预言之眼（预测） | `LOGO_PATHS.eye` |
| 虹膜 + 四节点电路 | 智能代理（AI 大脑） | `circle` + 4 个发光节点 |
| 虚线轨道（可选动效） | Agent 运行时 | `animation: borderSpin 18s linear infinite` |

## 2. 版本

| 版本 | 尺寸 | 用途 |
| --- | --- | --- |
| `<LogoMark size>` | 20–96px | 导航、加载、页脚、海报 |
| `<LogoLockup size>` | ≥ 32px | 导航栏（图标 + 字标） |
| `FAVICON_SVG` | 32px | 浏览器标签（内联 data URI，零额外请求） |
| `logoSvgDataUri(256)` | 256px | Canvas 海报 `drawImage` |

最小清晰尺寸 **20px**；低于此尺寸只保留眼形 + 虹膜，不要带轨道路径。

## 3. 色彩

| Token | Hex | 用途 |
| --- | --- | --- |
| `--brand` | `#34d399` | 主品牌 / YES / 成功 |
| `--brand-glow` | `#6ee7b7` | 高光、渐变起点 |
| `--brand-2` | `#22d3ee` | 次品牌（Cyan）/ 渐变终点 |
| `--brand-3` | `#a78bfa` | 强调（Violet），仅点缀 |
| `--danger` | `#fb7185` | NO / 风险 / 错误 |
| Ink | `#05060a` | 全局底色 |

渐变主用法：`linear-gradient(135deg, #6ee7b7, #34d399 45%, #22d3ee)`。
不要用纯 `#00ff00` 之类的荧光绿——会在地铁屏上糊成一团。

## 4. 字体与排版

- 中文：系统默认（PingFang / Noto Sans SC），标题 600，正文 400
- 数字：`ui-monospace` + `font-variant-numeric: tabular-nums`（概率跳动不抖）
- 标题字距 `tracking-tight`，正文 12–13px，辅助信息 10–11px

## 5. 组件规范

| 组件 | 规则 |
| --- | --- |
| 卡片 | 毛玻璃 `backdrop-blur-xl` + 165° 渐变 + 内高光；hover 上移 3px、流光描边、外发光 |
| 概率条 | 高 8px，YES 渐变填充，900ms 弹性缓动，NO 侧斜纹 |
| 按钮 | 主按钮渐变 + 内高光 + 外发光；次按钮 `white/8` 玻璃 |
| Toast | 右下堆叠，进场 240ms `cubic-bezier(.16,1,.3,1)` |
| 骨架屏 | 200% 宽度 shimmer，1.6s 线性 |

**禁止**：纯灰白底（`#f5f5f5` / `bg-white` 大面积）、1px 无渐变死边框、纯黑 `#000` 大面积背景。

## 6. 音效

WebAudio 现场合成（无素材、无网络请求），主音量 0.16：

| 场景 | 波形 | 频率 |
| --- | --- | --- |
| 点击 | triangle | 1180 Hz / 50ms |
| 下单成功 | triangle ×2 + sine | 880 → 1320 → 1760 Hz |
| 领取 / 卖出 | square + triangle | 660 → 990 → 1480 Hz |
| 报错 | sawtooth 下滑 | 300 → 180 Hz |

一键静音，状态持久化在 `localStorage:aura.sound.muted`；`prefers-reduced-motion` 不影响音效。

## 7. 海报（1200×630）

- 左侧 96px 安全边距：LOGO + 字标 + 题面（最多 3 行）+ 方向 + 概率 + 回报
- 右下：二维码（`?ref=share&m=<marketId>`）+「扫码进入市场」
- 页脚：`Base 主网 · 合约已验证 · 1 小时争议期 · 交易费 1.5%`
- 所有文字均为 Canvas 绘制，字体栈与网页一致，避免跨端字重漂移
