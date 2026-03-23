import { createHmac } from "node:crypto";
import { env } from "@/config/env";

function getPublicHost(): string {
  return process.env.NODE_ENV === "production"
    ? "https://kayle.id"
    : "https://localhost:3000";
}

function buildProxyHeaders(request: Request & { cf?: unknown }): Headers {
  const headers = new Headers(request.headers);
  const cf =
    request.cf && typeof request.cf === "object"
      ? JSON.stringify(request.cf)
      : null;

  if (cf) {
    const cfSignature = createHmac("sha256", env.KAYLE_INTERNAL_TOKEN)
      .update(cf)
      .digest("hex");

    headers.set("x-cf-geolocation", btoa(cf));
    headers.set("x-cf-signature", cfSignature);
  }

  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  if (clientIp) {
    headers.set("x-forwarded-client-ip", clientIp);
  }

  return headers;
}

export async function proxyInternalApiRequest({
  request,
  rewriteRedirectLocation,
}: {
  request: Request & { cf?: unknown };
  rewriteRedirectLocation?: (location: string, host: string) => string;
}): Promise<Response> {
  const host = getPublicHost();
  const url = new URL(request.url, host);
  const targetPath = `v1/${url.pathname?.replace("/api/", "")}`
    .replace(/\/+$/g, "")
    .replace(/\/\/+/g, "/");

  const response = await env.API.fetch(
    `http://api/${targetPath}${url.search}`,
    {
      body: request.body ?? undefined,
      credentials: "include",
      headers: buildProxyHeaders(request),
      method: request.method,
      redirect: "manual",
    }
  );

  if (
    rewriteRedirectLocation &&
    [301, 302, 303, 307, 308].includes(response.status)
  ) {
    const location = response.headers.get("Location");

    if (location) {
      const headers = new Headers(response.headers);
      headers.set("Location", rewriteRedirectLocation(location, host));

      return new Response(null, {
        headers,
        status: response.status,
      });
    }
  }

  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
  });
}
