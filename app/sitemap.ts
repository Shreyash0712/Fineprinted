import type { MetadataRoute } from "next";
import { loadServicesIndex } from "@/lib/static-data";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Use Vercel's URL variable if available, otherwise default to a standard fallback
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://fineprinted.vercel.app");

  let services: any[] = [];
  try {
    const data = await loadServicesIndex();
    services = data.services || [];
  } catch (e) {
    console.error("Failed to load services index for sitemap:", e);
  }

  const serviceUrls = services.map((s) => ({
    url: `${baseUrl}/s/${s.root_domain}`,
    lastModified: s.updated_at ? new Date(s.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const staticUrls = [
    {
      url: `${baseUrl}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    },
    {
      url: `${baseUrl}/request`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    },
    {
      url: `${baseUrl}/saved`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    },
    {
      url: `${baseUrl}/sitemap`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    },
  ];

  return [...staticUrls, ...serviceUrls];
}
