import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidAdminSession } from "@/lib/server/admin-session";
import { proxyAdminRequest } from "@/lib/server/admin-proxy";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidAdminSession(cookie)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return proxyAdminRequest("/admin/ops");
}
