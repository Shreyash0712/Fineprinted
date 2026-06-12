import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fineprinted: Terms of Service Monitor",
    short_name: "Fineprinted",
    description: "Automated AI monitoring of Terms of Service and Privacy Policies.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF9F5",
    theme_color: "#8b6e44",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
