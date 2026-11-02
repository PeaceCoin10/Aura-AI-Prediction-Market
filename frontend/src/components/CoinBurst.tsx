import { useEffect, useState } from "react";
import { BURST_EVENT, type BurstDetail } from "../lib/fx";

interface Coin {
  id: number;
  left: number;
  top: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  size: number;
}

let seq = 0;

/**
 * Gold particles for share / copy / check-in actions.
 *
 * Rendered once near the app root. Coins are absolutely positioned and animated by CSS, then
 * dropped from state — no canvas, no rAF loop, nothing to leak if the user fires ten in a row.
 */
export function CoinBurst() {
  const [coins, setCoins] = useState<Coin[]>([]);

  useEffect(() => {
    const onBurst = (e: Event) => {
      const { x, y, count = 14 } = (e as CustomEvent<BurstDetail>).detail;
      const batch: Coin[] = Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 70 + Math.random() * 90;
        return {
          id: ++seq,
          left: x,
          top: y,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 40,
          rot: Math.random() * 360 - 180,
          delay: Math.random() * 90,
          size: 9 + Math.random() * 7,
        };
      });
      setCoins((prev) => [...prev.slice(-48), ...batch]);
      window.setTimeout(() => {
        setCoins((prev) => prev.filter((c) => !batch.some((b) => b.id === c.id)));
      }, 1200);
    };
    window.addEventListener(BURST_EVENT, onBurst);
    return () => window.removeEventListener(BURST_EVENT, onBurst);
  }, []);

  if (!coins.length) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
      {coins.map((c) => (
        <span
          key={c.id}
          className="aura-coin"
          style={{
            left: c.left,
            top: c.top,
            width: c.size,
            height: c.size,
            animationDelay: `${c.delay}ms`,
            ["--dx" as string]: `${c.dx}px`,
            ["--dy" as string]: `${c.dy}px`,
            ["--rot" as string]: `${c.rot}deg`,
          }}
        />
      ))}
    </div>
  );
}
