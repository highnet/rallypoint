import type { MetadataRoute } from "next";

import { agents } from "@/lib/agents";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rallypoint.tools";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/docs`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...agents.map((agent) => ({
      url: `${siteUrl}/agents/${agent.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
