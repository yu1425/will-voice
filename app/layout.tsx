import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./flow.css";

export const metadata: Metadata = {
  title: "うぃる | WILL公式キャラクター",
  applicationName: "うぃる",
  description:
    "WILL公式キャラクター「うぃる」のサイト。進行アシスタント、チャットなどのコンテンツをまとめています。",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "うぃる | WILL公式キャラクター",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "32x32" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F7F7F5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
