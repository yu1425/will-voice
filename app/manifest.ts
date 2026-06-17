import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "うぃるvoice",
    short_name: "うぃる",
    description:
      "WILL.tennis マスコット「うぃる」のAI音声アシスタント。テニス会の進行をサポートします。",
    start_url: "/",
    display: "standalone",
    background_color: "#fff0f5",
    theme_color: "#FF6B9D",
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
