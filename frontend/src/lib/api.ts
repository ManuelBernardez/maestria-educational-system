import { supabase } from "@/lib/supabase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000/api" : "")).replace(/\/+$/, "");

type ApiErrorBody = { detail?: unknown; error?: unknown; [key: string]: unknown };

function messageFromBody(body: ApiErrorBody, status: number): string {
  const candidate = body.detail ?? body.error;
  if (typeof candidate === "string" && candidate.trim()) return candidate;
  if (candidate !== undefined) return JSON.stringify(candidate);
  const fields = Object.entries(body).filter(([key]) => key !== "status");
  if (fields.length) return fields.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : JSON.stringify(value)}`).join("; ");
  return `Error ${status}: no se pudo completar la solicitud.`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error("Falta NEXT_PUBLIC_API_URL. Configurá la URL pública de la API antes de usar la aplicación.");
  const sessionResult = await supabase?.auth.getSession();
  const token = sessionResult?.data.session?.access_token;
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    const parsed = await response.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" ? parsed as ApiErrorBody : {};
    throw new Error(messageFromBody(body, response.status));
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get("content-type")?.includes("text/markdown")) return response.text() as Promise<T>;
  return response.json() as Promise<T>;
}


/** Download an authenticated file response without exposing the access token in a URL. */
export async function downloadApiFile(path: string, fallbackName: string): Promise<void> {
  if (!API_URL) throw new Error("Falta NEXT_PUBLIC_API_URL. Configurá la URL pública de la API antes de usar la aplicación.");
  const sessionResult = await supabase?.auth.getSession();
  const token = sessionResult?.data.session?.access_token;
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, { headers, cache: "no-store", credentials: "omit" });
  if (!response.ok) {
    const parsed = await response.json().catch(() => ({}));
    const body = parsed && typeof parsed === "object" ? parsed as ApiErrorBody : {};
    throw new Error(messageFromBody(body, response.status));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = match?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl; anchor.download = filename; anchor.rel = "noopener";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
