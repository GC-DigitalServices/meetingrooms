import type { Metadata, Viewport } from "next";
import SwRegistrar from "./SwRegistrar";

export const metadata: Metadata = {
  manifest: "/manifest.json",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#00534C",
  width: "device-width",
  initialScale: 1,
  userScalable: false,
};

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SwRegistrar />
      {children}
    </>
  );
}
