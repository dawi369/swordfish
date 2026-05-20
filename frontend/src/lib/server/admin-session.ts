import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ADMIN_PANEL_PASSWORD, ADMIN_PANEL_SESSION_SECRET } from "@/config/env.server";

export const ADMIN_SESSION_COOKIE = "mk3_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 4;

function sessionToken(): string | null {
  if (!ADMIN_PANEL_PASSWORD || !ADMIN_PANEL_SESSION_SECRET) {
    return null;
  }

  return createHash("sha256")
    .update(`${ADMIN_PANEL_PASSWORD}:${ADMIN_PANEL_SESSION_SECRET}`)
    .digest("hex");
}

export function getAdminSessionToken(): string | null {
  return sessionToken();
}

export function isValidAdminSession(value: string | undefined): boolean {
  const expected = sessionToken();
  if (!expected || !value) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(value);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function readCookieHeader(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return undefined;
}

export function isAuthorizedAdminRequest(request: NextRequest): boolean {
  const cookie =
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value ??
    readCookieHeader(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);

  return isValidAdminSession(cookie);
}

export function verifyAdminPassword(password: string): boolean {
  if (!ADMIN_PANEL_PASSWORD) {
    return false;
  }

  const expectedBuffer = Buffer.from(ADMIN_PANEL_PASSWORD);
  const actualBuffer = Buffer.from(password);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
