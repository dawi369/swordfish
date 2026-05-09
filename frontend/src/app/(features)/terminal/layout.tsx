"use client";

import { Suspense } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { SubscriptionGuard } from "@/components/auth/subscription-guard";
import { SpotlightProvider } from "@/components/terminal/layout/spotlight/spotlight-provider";
import { Spotlight } from "@/components/terminal/layout/spotlight/spotlight";
import { TickerModal } from "@/components/terminal/ticker-modal/ticker-modal";
import { HeaderProvider } from "@/components/terminal/layout/header-provider";
import { TerminalHeader } from "@/components/terminal/layout/terminal-header";
import { TerminalDock } from "@/components/terminal/layout/terminal-dock";
import { TerminalViewProvider, useTerminalView } from "@/providers/terminal-view-provider";
import { AdminPanel } from "@/components/terminal/admin/admin-panel";

function TerminalLayoutContent({ children }: { children: React.ReactNode }) {
  const { activeView, setActiveView } = useTerminalView();

  return (
    <div className="flex h-dvh overflow-hidden flex-col relative">
      <TerminalHeader />
      <main className="flex-1 overflow-hidden px-4 pb-4">{children}</main>
      {/* Spacer footer - half header height (h-14 / 2 = h-7) for dock separation */}
      <div className="h-7 shrink-0" />
      <Spotlight />
      <AdminPanel />
      <TickerModal />
      <TerminalDock activeView={activeView} onSelect={setActiveView} />
    </div>
  );
}

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="h-screen bg-neutral-950" />}>
      <TerminalViewProvider>
        <HeaderProvider>
          <SpotlightProvider>
            <ProtectedRoute redirectTo="/login">
              <SubscriptionGuard>
                <TerminalLayoutContent>{children}</TerminalLayoutContent>
              </SubscriptionGuard>
            </ProtectedRoute>
          </SpotlightProvider>
        </HeaderProvider>
      </TerminalViewProvider>
    </Suspense>
  );
}
