import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL,
} from "@/config/env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const STATIC_PATHS = new Set(["/manifest.json", "/robots.txt", "/sitemap.xml"]);
const STATIC_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".map",
  ".json",
  ".ico",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".txt",
]);
const WAITLIST_PATH = "/waitlist";
const HEALTHCHECK_PATH = "/health";
const AUTH_REFRESH_PREFIXES = ["/terminal", "/billing", "/settings", "/onboarding"];
const AUTH_REFRESH_PATHS = new Set(["/checkout"]);

function parseHost(hostHeader: string | null): string {
  if (!hostHeader) return "";
  const rawHost = hostHeader.split(",")[0]?.trim() ?? "";
  return rawHost.split(":")[0]?.toLowerCase() ?? "";
}

function getCanonicalHost(): string {
  try {
    return new URL(NEXT_PUBLIC_SITE_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parseHosts(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function shouldRefreshAuth(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase();

  if (AUTH_REFRESH_PATHS.has(normalizedPath)) {
    return true;
  }

  return AUTH_REFRESH_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();

  if (url.pathname === HEALTHCHECK_PATH) {
    return new Response("ok", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const hostname = parseHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  );

  const canonicalHost = getCanonicalHost();
  const extraAllowedHosts = parseHosts(process.env.WAITLIST_ALLOWED_HOSTS);
  const extraWaitlistHosts = parseHosts(process.env.WAITLIST_HOSTS);
  const isLocalHost = LOCAL_HOSTS.has(hostname);
  const isWaitlistHost =
    hostname.startsWith("waitlist.") ||
    hostname.startsWith("waitlist-") ||
    extraWaitlistHosts.includes(hostname) ||
    (canonicalHost && hostname === canonicalHost);
  const waitlistOnly = process.env.WAITLIST_ONLY === "true";
  const allowedHosts = new Set([
    ...LOCAL_HOSTS,
    ...extraAllowedHosts,
    ...extraWaitlistHosts,
  ]);
  if (canonicalHost) {
    allowedHosts.add(canonicalHost);
  }

  if (
    process.env.NODE_ENV === "production" &&
    canonicalHost &&
    hostname &&
    !allowedHosts.has(hostname)
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.hostname = canonicalHost;
    redirectUrl.protocol = "https:";
    redirectUrl.port = "";
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (url.pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const pathname = url.pathname.toLowerCase();
  const extensionIndex = pathname.lastIndexOf(".");
  if (extensionIndex !== -1) {
    const ext = pathname.slice(extensionIndex);
    if (STATIC_EXTENSIONS.has(ext)) {
      return NextResponse.next();
    }
  }

  if (!STATIC_PATHS.has(url.pathname)) {
    const shouldForceWaitlist = false;
    if (shouldForceWaitlist && url.pathname !== WAITLIST_PATH) {
      url.pathname = WAITLIST_PATH;
      return NextResponse.rewrite(url);
    }
  }

  if (!shouldRefreshAuth(url.pathname)) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh session if expired - this ensures sessions are restored from cookies
  await supabase.auth.getUser();

  return supabaseResponse;
}
