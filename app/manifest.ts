import type { MetadataRoute } from "next";
import { APP_AUTHOR_CREDIT } from "@/lib/utils";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CBT SMART EXAM",
    short_name: "CBT Smart",
    description: `Platform ujian berbasis komputer sekolah yang aman dan andal. ${APP_AUTHOR_CREDIT}.`,
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0f172a",
    theme_color: "#1e3a8a",
    lang: "id",
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
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
