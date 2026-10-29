/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#08090d", 900: "#0d0f16", 850: "#12141d", 800: "#171a25", 700: "#232838" },
        brand: { DEFAULT: "#34d399", dim: "#10b981", glow: "#6ee7b7" },
        danger: { DEFAULT: "#fb7185", dim: "#f43f5e" },
      },
      boxShadow: { glow: "0 0 24px -6px rgba(52,211,153,0.45)" },
    },
  },
  plugins: [],
};
