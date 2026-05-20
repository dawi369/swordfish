import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/server/admin-session";
import { proxyAdminRequest } from "@/lib/server/admin-proxy";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ command: string }> },
) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json(
      { error: "Unauthorized", reason: "missing_or_invalid_admin_session" },
      { status: 401 },
    );
  }

  const { command } = await context.params;
  return proxyAdminRequest(`/admin/commands/${encodeURIComponent(command)}/run`, {
    method: "POST",
  });
}
