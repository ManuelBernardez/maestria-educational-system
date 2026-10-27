import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return [
    { url: site, changeFrequency: "monthly", priority: 1 },
    { url: `${site}/como-funciona`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site}/sobre-nosotros`, changeFrequency: "yearly", priority: 0.6 },
    { url: `${site}/preguntas-frecuentes`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site}/accesibilidad`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${site}/privacidad`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${site}/terminos`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${site}/contacto`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
