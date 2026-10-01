import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "うぃる | WILL.tennis公式キャラクター",
    short_name: "うぃる",
    description:
      "WILL.tennis公式キャラクター「うぃる」のサイト。進行アシスタントやチャットなどをまとめています。",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F7F5",
    theme_color: "#455A73",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
