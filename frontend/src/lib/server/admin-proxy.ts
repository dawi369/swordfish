import { NextResponse } from "next/server";
import { HUB_API_KEY, HUB_URL } from "@/config/env.server";

export async function proxyAdminRequest(path: string, init: RequestInit = {}) {
  if (!HUB_URL || !HUB_API_KEY) {
    return NextResponse.json(
      { error: "Admin backend is not configured" },
      { status: 503 },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${HUB_URL}${path}`, {
      ...init,
      headers: {
        "X-API-Key": HUB_API_KEY,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error(`Admin backend request failed for ${path}:`, error);
    return NextResponse.json(
      {
        error: "Admin backend is unreachable",
        details: HUB_URL,
      },
      { status: 503 },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (response.status === 401) {
    return NextResponse.json(
      {
        error: "Admin backend rejected the configured HUB_API_KEY",
        details: "Make sure frontend HUB_API_KEY matches backend HUB_API_KEY.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(payload, { status: response.status });
}
