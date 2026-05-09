import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/server/admin-session";
import { proxyAdminRequest } from "@/lib/server/admin-proxy";

const ACTION_PATHS: Record<string, string> = {
  "refresh-subscriptions": "/admin/refresh-subscriptions",
  "refresh-front-months": "/admin/refresh-front-months",
  "refresh-snapshots": "/admin/refresh-snapshots",
  "recovery-backfill": "/admin/recovery/backfill",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = await context.params;
  const path = ACTION_PATHS[action];
  if (!path) {
    return NextResponse.json({ error: "Unknown admin action" }, { status: 404 });
  }

  return proxyAdminRequest(path, { method: "POST" });
}
