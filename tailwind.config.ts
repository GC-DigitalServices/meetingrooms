import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // ─── Greenhead College brand colours (Material You) ───────────────────
      colors: {
        // Core brand — DEFAULT used by bg-primary, foreground by text-primary-foreground
        primary: { DEFAULT: "#003a35", foreground: "#ffffff" },
        "on-primary": "#ffffff",
        "primary-container": "#00534c",
        "on-primary-container": "#83c5bc",
        "primary-fixed": "#acefe5",
        "primary-fixed-dim": "#91d3c9",
        "on-primary-fixed": "#00201d",
        "on-primary-fixed-variant": "#005049",
        "inverse-primary": "#91d3c9",
        "surface-tint": "#246961",

        // Secondary (amber / CTA)
        secondary: { DEFAULT: "#855300", foreground: "#ffffff" },
        "on-secondary": "#ffffff",
        "secondary-container": "#f9a000",
        "on-secondary-container": "#633d00",
        "secondary-fixed": "#ffddb7",
        "secondary-fixed-dim": "#ffb95e",
        "on-secondary-fixed": "#2a1700",
        "on-secondary-fixed-variant": "#653e00",

        // Tertiary (rose / accent)
        tertiary: "#6a0033",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#930249",
        "on-tertiary-container": "#ff9cb9",
        "tertiary-fixed": "#ffd9e1",
        "tertiary-fixed-dim": "#ffb1c6",
        "on-tertiary-fixed": "#3f001b",
        "on-tertiary-fixed-variant": "#8e0047",

        // Error
        error: "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",

        // Surface hierarchy
        background: "#fbf9f8",
        "on-background": "#1b1c1c",
        surface: "#fbf9f8",
        "on-surface": "#1b1c1c",
        "surface-variant": "#e4e2e1",
        "on-surface-variant": "#3f4947",
        "surface-dim": "#dcd9d9",
        "surface-bright": "#fbf9f8",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f6f3f2",
        "surface-container": "#f0eded",
        "surface-container-high": "#eae8e7",
        "surface-container-highest": "#e4e2e1",

        // Inverse
        "inverse-surface": "#303030",
        "inverse-on-surface": "#f3f0f0",

        // Outline
        outline: "#6f7977",
        "outline-variant": "#bfc9c6",

        // Status (kept from original design)
        "status-free": "var(--status-free)",
        "status-busy": "var(--status-busy)",
        "status-soon": "var(--status-soon)",

        // shadcn compatibility (maps to Greenhead tokens)
        background2: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },

      // ─── Typography ───────────────────────────────────────────────────────
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        "label-sm": ["Inter", "sans-serif"],
        "label-md": ["Inter", "sans-serif"],
        "body-md": ["Inter", "sans-serif"],
        "body-lg": ["Inter", "sans-serif"],
        "headline-md": ["Plus Jakarta Sans", "sans-serif"],
        "headline-lg": ["Plus Jakarta Sans", "sans-serif"],
        "headline-xl": ["Plus Jakarta Sans", "sans-serif"],
      },
      fontSize: {
        "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "label-md": ["14px", { lineHeight: "20px", letterSpacing: "0.05em", fontWeight: "600" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "headline-lg": ["32px", { lineHeight: "40px", letterSpacing: "-0.01em", fontWeight: "700" }],
        "headline-xl": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em", fontWeight: "800" }],
      },

      // ─── Spacing ──────────────────────────────────────────────────────────
      spacing: {
        xs: "4px",
        base: "8px",
        sm: "12px",
        md: "24px",
        lg: "48px",
        xl: "80px",
        gutter: "24px",
        "margin-mobile": "16px",
        "margin-desktop": "64px",
      },

      // ─── Border radius ────────────────────────────────────────────────────
      borderRadius: {
        DEFAULT: "0.25rem",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "0.75rem",
        full: "9999px",
      },

      boxShadow: {
        card: "0px 4px 20px rgba(55,55,55,0.08)",
        "card-hover": "0px 8px 30px rgba(55,55,55,0.12)",
      },
    },
  },
  plugins: [animate],
};

export default config;
