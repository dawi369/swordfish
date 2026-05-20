import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  isAuthorizedAdminRequest,
} from "@/lib/server/admin-session";
import { proxyAdminRequest } from "@/lib/server/admin-proxy";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        reason: "missing_or_invalid_admin_session",
      },
      { status: 401 },
    );
  }

  return proxyAdminRequest("/admin/ops");
}
