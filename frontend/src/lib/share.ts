/**
 * Share poster engine (pure front-end Canvas: no backend, no third-party service)
 *
 * Renders a 1200×630 poster: mesh gradient backdrop + brand mark + market question + your side
 * + current probability + potential return + a branded invite QR code. It can be downloaded
 * directly or handed to the X (Twitter) intent flow.
 */
import QRCode from "qrcode";
import { BRAND, logoSvgDataUri } from "../components/BrandLogo";
import { format } from "./i18n";
import { en } from "../locales/en";

export const SHARE_SITE = "https://aura.hermes.markets";

const P = en.content.poster;

export interface PosterInput {
  question: string;
  category: string;
  side: "YES" | "NO" | "NEUTRAL";
  prob: number; // 0..1
  potentialReturn?: string; // e.g. "2.4x"
  mode?: "real" | "paper";
  marketId?: string;
}

export interface PosterResult {
  dataUrl: string;
  shareUrl: string;
  tweet: string;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.join("").length < text.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
  }
  return lines;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderPoster(input: PosterInput): Promise<PosterResult> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(P.canvasUnavailable);

  // ---- Background: mesh gradient ----
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, W, H);
  const blobs: Array<[number, number, number, string]> = [
    [120, 40, 520, "rgba(52,211,153,0.45)"],
    [1020, 20, 460, "rgba(34,211,238,0.34)"],
    [880, 600, 520, "rgba(167,139,250,0.3)"],
    [180, 640, 420, "rgba(251,113,133,0.22)"],
  ];
  for (const [x, y, r, color] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(5,6,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // ---- Glass card ----
  ctx.save();
  rounded(ctx, 56, 56, W - 112, H - 112, 32);
  const cardGrad = ctx.createLinearGradient(56, 56, W - 56, H - 56);
  cardGrad.addColorStop(0, "rgba(255,255,255,0.075)");
  cardGrad.addColorStop(1, "rgba(6,8,13,0.62)");
  ctx.fillStyle = cardGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ---- Logo + wordmark ----
  try {
    const logo = await loadImage(logoSvgDataUri(256));
    ctx.drawImage(logo, 96, 92, 72, 72);
  } catch {
    /* Ignore: a failed logo load must not block the poster */
  }
  ctx.font = "600 30px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const grad = ctx.createLinearGradient(184, 100, 420, 150);
  grad.addColorStop(0, "#6ee7b7");
  grad.addColorStop(0.5, "#34d399");
  grad.addColorStop(1, "#22d3ee");
  ctx.fillStyle = grad;
  ctx.fillText(BRAND.name, 184, 128);
  ctx.font = "400 15px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(203,213,225,0.72)";
  ctx.fillText(P.tagline, 184, 154);

  // Mode badge, top right
  const modeLabel = input.mode === "paper" ? P.modePaper : P.modeReal;
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  const labelW = ctx.measureText(modeLabel).width + 28;
  rounded(ctx, W - 96 - labelW, 96, labelW, 34, 17);
  ctx.fillStyle = "rgba(52,211,153,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(52,211,153,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#6ee7b7";
  ctx.fillText(modeLabel, W - 96 - labelW + 14, 118);

  // ---- Market question ----
  ctx.font = "600 40px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#f1f5f9";
  const lines = wrap(ctx, input.question, W - 240, 3);
  lines.forEach((line, i) => ctx.fillText(line, 96, 236 + i * 54));

  // ---- Side + probability ----
  const isYes = input.side === "YES";
  const isNo = input.side === "NO";
  const sideColor = isYes ? "#34d399" : isNo ? "#fb7185" : "#cbd5e1";
  ctx.font = "700 64px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = sideColor;
  const sideText = input.side === "NEUTRAL" ? P.sideNeutral : format(P.sideBet, { side: input.side });
  ctx.fillText(sideText, 96, 470);

  ctx.font = "500 20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(203,213,225,0.7)";
  ctx.fillText(P.probLabel, 96, 508);
  ctx.font = "700 34px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#f1f5f9";
  ctx.fillText(`${(input.prob * 100).toFixed(1)}%`, 96, 548);

  if (input.potentialReturn) {
    ctx.font = "500 20px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(203,213,225,0.7)";
    ctx.fillText(P.returnLabel, 336, 508);
    ctx.font = "700 34px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#6ee7b7";
    ctx.fillText(input.potentialReturn, 336, 548);
  }

  // ---- QR code (ref param for referral attribution) ----
  const shareUrl = `${SHARE_SITE}/?ref=share&m=${input.marketId ?? "feed"}`;
  const qrData = await QRCode.toDataURL(shareUrl, {
    margin: 1,
    width: 300,
    color: { dark: "#04120cff", light: "#eafff5ff" },
  });
  const qrImg = await loadImage(qrData);
  rounded(ctx, W - 96 - 168, H - 96 - 168, 168, 168, 16);
  ctx.fillStyle = "#eafff5";
  ctx.fill();
  ctx.drawImage(qrImg, W - 96 - 160, H - 96 - 160, 152, 152);
  ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(203,213,225,0.6)";
  ctx.fillText(P.scanQr, W - 96 - 160, H - 96 - 176);

  // ---- Footer ----
  ctx.font = "400 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(148,163,184,0.65)";
  ctx.fillText(P.footer, 96, H - 96);

  const dataUrl = canvas.toDataURL("image/png");
  const tweet = format(P.tweet, {
    lead: input.side === "NEUTRAL" ? P.tweetLeadNeutral : format(P.tweetLeadBet, { side: input.side }),
    question: input.question,
    prob: (input.prob * 100).toFixed(1),
    potential: input.potentialReturn ? format(P.tweetPotential, { ret: input.potentialReturn }) : "",
  });
  return { dataUrl, shareUrl, tweet: `${tweet} ${HASHTAGS}` };
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Growth loop: every share carries the same four tags so the timeline compounds. */
export const HASHTAGS = "#PredictionMarkets #Base #AI #Crypto";

export function openTweet(text: string, url: string): void {
  const u = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(u, "_blank", "noopener,noreferrer");
}
