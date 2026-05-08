"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTickerStore } from "@/store/use-ticker-store";
import { useConnection } from "@/providers/connection-provider";
import { ASSET_CLASSES } from "@/lib/ticker-mapping";
import { NEXT_PUBLIC_HUB_URL } from "@/config/env";

function DebugPanel() {
  const mode = useTickerStore((state) => state.mode);
  const entitiesFront = useTickerStore((state) => state.entitiesByMode["front"]);
  const entitiesCurve = useTickerStore((state) => state.entitiesByMode["curve"]);
  const seriesFront = useTickerStore((state) => state.seriesByMode["front"]);
  const seriesCurve = useTickerStore((state) => state.seriesByMode["curve"]);
  const indexFront = useTickerStore((state) => state.byAssetClassByMode["front"]);
  const indexCurve = useTickerStore((state) => state.byAssetClassByMode["curve"]);
  const selection = useTickerStore((state) => state.selectionByMode[mode]);
  const { status } = useConnection();
  const [endpointData, setEndpointData] = useState<{ endpoint: string; status: number; preview: string } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkEndpoint = useCallback(async () => {
    setIsChecking(true);
    try {
      const res = await fetch(`${NEXT_PUBLIC_HUB_URL}/symbols`);
      const data = await res.json();
      const symbols = Array.isArray(data) ? data : data?.symbols;
      setEndpointData({
        endpoint: `${NEXT_PUBLIC_HUB_URL}/symbols`,
        status: res.status,
        preview: `symbols: ${Array.isArray(symbols) ? symbols.length : 0} items`
      });
    } catch (err) {
      setEndpointData({
        endpoint: `${NEXT_PUBLIC_HUB_URL}/symbols`,
        status: 0,
        preview: `Error: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void checkEndpoint();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [checkEndpoint]);

  const stats = useMemo(() => {
    const frontSymbols = Object.keys(entitiesFront);
    const curveSymbols = Object.keys(entitiesCurve);
    
    const frontWithData = frontSymbols.filter(s => seriesFront[s]?.length > 0);
    const curveWithData = curveSymbols.filter(s => seriesCurve[s]?.length > 0);

    return {
      front: {
        total: frontSymbols.length,
        withData: frontWithData.length,
        byAsset: ASSET_CLASSES.map(ac => ({
          id: ac.id,
          title: ac.title,
          count: indexFront[ac.id]?.length || 0,
          withData: (indexFront[ac.id] || []).filter(s => seriesFront[s]?.length > 0).length
        }))
      },
      curve: {
        total: curveSymbols.length,
        withData: curveWithData.length,
        byAsset: ASSET_CLASSES.map(ac => ({
          id: ac.id,
          title: ac.title,
          count: indexCurve[ac.id]?.length || 0,
          withData: (indexCurve[ac.id] || []).filter(s => seriesCurve[s]?.length > 0).length
        }))
      }
    };
  }, [entitiesFront, entitiesCurve, seriesFront, seriesCurve, indexFront, indexCurve]);

  return (
    <Card className="bg-black/50 border-zinc-800 mb-4">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-mono text-zinc-400 flex items-center justify-between">
          <span>🔧 Debug Panel</span>
          <Badge variant={status === "connected" ? "outline" : "destructive"} className="text-xs">
            WS: {status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-emerald-400">FRONT MODE</h4>
            <div className="text-xs font-mono text-zinc-400">
              Total: <span className="text-zinc-200">{stats.front.total}</span> | 
              With Data: <span className="text-zinc-200">{stats.front.withData}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-zinc-500">
              {stats.front.byAsset.map(ac => (
                <div key={ac.id} className="flex justify-between">
                  <span>{ac.title}:</span>
                  <span className={ac.count === 0 ? "text-red-400" : "text-zinc-300"}>
                    {ac.count} <span className="text-zinc-600">({ac.withData})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-blue-400">CURVE MODE (Scaffold)</h4>
            <div className="text-xs font-mono text-zinc-400">
              Total: <span className="text-zinc-200">{stats.curve.total}</span> | 
              With Data: <span className="text-zinc-200">{stats.curve.withData}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-zinc-500">
              {stats.curve.byAsset.map(ac => (
                <div key={ac.id} className="flex justify-between">
                  <span>{ac.title}:</span>
                  <span className={ac.count === 0 ? "text-amber-500" : "text-zinc-300"}>
                    {ac.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-2 space-y-1">
          <h4 className="text-xs font-bold text-zinc-400">CURRENT STATE</h4>
          <div className="text-[10px] font-mono text-zinc-500 flex gap-4">
            <span>Mode: <span className="text-zinc-300">{mode.toUpperCase()}</span></span>
            <span>Primary: <span className="text-zinc-300">{selection.primary || "—"}</span></span>
            <span>Selected: <span className="text-zinc-300">[{selection.selected.join(", ") || "—"}]</span></span>
            <span>Spread: <span className={selection.spreadEnabled ? "text-emerald-400" : "text-zinc-600"}>
              {selection.spreadEnabled ? "ON" : "OFF"}
            </span></span>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-2 flex items-center justify-between">
          <div className="text-[10px] font-mono text-zinc-500">
            Endpoint: <span className="text-zinc-400">{endpointData?.endpoint}</span>
            <span className="ml-2">
              Status: <span className={endpointData?.status === 200 ? "text-emerald-400" : "text-red-400"}>
                {endpointData?.status || "—"}
              </span>
            </span>
            <span className="ml-2 text-zinc-400">{endpointData?.preview}</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-6 text-[10px] px-2"
            onClick={checkEndpoint}
            disabled={isChecking}
          >
            {isChecking ? "Checking..." : "Refresh"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StreamView() {
  const mode = useTickerStore((state) => state.mode);
  const marketData = useTickerStore((state) => state.seriesByMode[mode]);
  const { status } = useConnection();

  // Flatten all bars for display
  const allBars = Object.entries(marketData).flatMap(([symbol, bars]) =>
    bars.map((bar) => ({ ...bar, symbol }))
  );

  // Sort by time descending for the log view
  const sortedBars = [...allBars].sort((a, b) => b.startTime - a.startTime).slice(0, 100);

  return (
    <div className="h-full w-full flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Stream (Dev)</h1>
          <p className="text-muted-foreground text-sm">
            Real-time feed from Redis Stream via WebSocket Proxy
          </p>
        </div>
        <Badge variant={status === "connected" ? "default" : "destructive"}>
          {status.toUpperCase()}
        </Badge>
      </header>

      <DebugPanel />

      <Card className="flex-1 overflow-hidden bg-black/50 border-zinc-800">
        <ScrollArea className="h-full p-4">
          <div className="space-y-2 font-mono text-xs">
            {sortedBars.map((bar, i) => (
              <div
                key={`${bar.symbol}-${bar.startTime}-${i}`}
                className="flex gap-4 p-2 hover:bg-white/5 rounded transition-colors border-b border-white/5 last:border-0"
              >
                <span className="text-zinc-500 w-24 shrink-0">
                  {new Date(bar.startTime).toLocaleTimeString()}
                </span>
                <span className="text-blue-400 w-20 shrink-0">{bar.symbol}</span>
                <span className="text-zinc-300 break-all">
                  O:{bar.open} H:{bar.high} L:{bar.low} C:{bar.close} V:{bar.volume}
                </span>
              </div>
            ))}
            {sortedBars.length === 0 && (
              <div className="text-center text-zinc-500 py-12">Waiting for data...</div>
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
