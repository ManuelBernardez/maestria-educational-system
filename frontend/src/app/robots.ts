import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/", "/como-funciona", "/preguntas-frecuentes", "/sobre-nosotros", "/accesibilidad", "/privacidad", "/terminos", "/contacto"], disallow: ["/app", "/app/", "/login", "/login/", "/recuperar-clave", "/restablecer-clave"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
