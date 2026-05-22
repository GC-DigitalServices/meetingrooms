import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Status colours are defined as CSS variables in globals.css.
      // Use them as: bg-[var(--status-free)] etc.
      colors: {
        "status-free": "var(--status-free)",
        "status-busy": "var(--status-busy)",
        "status-soon": "var(--status-soon)",
      },
    },
  },
  plugins: [],
};

export default config;
