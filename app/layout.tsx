import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "うぃるくん進行",
  applicationName: "うぃるくん進行",
  description:
    "社会人テニスサークル WILL.tennis のマスコット「うぃる」のAI音声アシスタント。テニス会の進行サポートに。",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "うぃるくん進行",
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
  maximumScale: 1,
  themeColor: "#5fae6e",
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
