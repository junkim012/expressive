import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        terminal: {
          bg: "#000000",
          panel: "#080808",
          border: "#1c1c1c",
          "border-bright": "#2e2e2e",
          text: "#d4d4d4",
          muted: "#525252",
          green: "#22c55e",
          "green-dim": "#15803d",
          amber: "#f59e0b",
          "amber-dim": "#b45309",
          red: "#ef4444",
          blue: "#3b82f6",
          header: "#0a0a0a",
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
