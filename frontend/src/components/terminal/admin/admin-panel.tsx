"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  Lock,
  Play,
  RefreshCw,
  Server,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from "@/lib/analytics";

type ServiceState = "connected" | "disconnected" | "disabled";

interface JobStatus {
  lastRunTime: number | null;
  lastSuccess: boolean;
  lastError: string | null;
  totalRuns: number;
  clearedKeys?: number;
  symbolsUpdated?: number;
  productsUpdated?: number;
}

interface AdminJob {
  id: string;
  label: string;
  cron: string;
  timezone: string;
  description: string;
  nextRunTime: number | null;
  scheduled: boolean;
  status: JobStatus;
}

interface AgeSummary {
  count: number;
  minAgeMs: number | null;
  medianAgeMs: number | null;
  maxAgeMs: number | null;
}

interface FreshnessEntry {
  newestTimestamp: number | null;
  newestAgeMs: number | null;
  oldestTimestamp?: number | null;
  oldestAgeMs?: number | null;
  ageSummary?: AgeSummary;
}

interface AdminOps {
  status: "ok" | "warming" | "degraded";
  timestamp: number;
  services: {
    redis: ServiceState;
    timescaledb: ServiceState;
    massiveWs: ServiceState;
  };
  redis: {
    date: string;
    barCount: number;
    symbolCount: number;
    latestBarCount: number;
    snapshotCount: number;
    activeContractProductCount: number;
    recoveryCheckpointCount: number;
    subscribedSymbolCount: number;
    streamLength?: number;
    dbSize?: number;
    usedMemoryBytes?: number | null;
    indexCounts?: {
      snapshots: number;
      activeContracts: number;
      recoveryCheckpoints: number;
    };
  };
  freshness: Record<string, FreshnessEntry>;
  jobs: Record<string, AdminJob>;
  jobSummary?: {
    failedJobs: string[];
    pendingJobs: string[];
    totalJobs: number;
    successfulJobs: number;
  };
  subscriptions: {
    upstreamCount: number;
    totalSymbols: number;
    persistedSymbols: string[];
  };
}

interface AdminCommand {
  id: string;
  label: string;
  description: string;
}

interface AdminCommandRun {
  id: string;
  command: AdminCommand;
  status: "success" | "error";
  startedAt: number;
  completedAt: number;
  durationMs: number;
  lines: string[];
  output: unknown;
}

const ACTIONS = [
  {
    id: "refresh-snapshots",
    label: "Snapshots",
    description: "Refresh cached settlement and session snapshot data.",
  },
  {
    id: "refresh-front-months",
    label: "Front months",
    description: "Rebuild active contracts and front-month ranking.",
  },
  {
    id: "refresh-subscriptions",
    label: "Subscriptions",
    description: "Rebuild upstream Massive subscriptions.",
  },
  {
    id: "recovery-backfill",
    label: "Recovery backfill",
    description: "Backfill subscribed symbols from provider history.",
  },
];

function formatTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatAge(ms: number | null | undefined): string {
  if (ms == null) return "--";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return "--";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function StatusBadge({ value }: { value: string }) {
  const ok =
    value === "ok" ||
    value === "connected" ||
    value === "true" ||
    value === "success";
  const disabled = value === "disabled";
  const warming = value === "warming" || value === "not_run";
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-white/10 bg-white/5 font-mono uppercase tracking-wide",
        ok && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        warming && "border-amber-400/30 bg-amber-400/10 text-amber-300",
        !ok && !disabled && !warming && "border-rose-400/30 bg-rose-400/10 text-rose-300",
        disabled && "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
      )}
    >
      {value}
    </Badge>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border/60 bg-background/40 rounded-md border p-4">
      <div className="text-muted-foreground text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-2 font-mono text-2xl text-foreground">{value}</div>
    </div>
  );
}

export function AdminPanel() {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [ops, setOps] = useState<AdminOps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [commands, setCommands] = useState<AdminCommand[]>([]);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [commandRuns, setCommandRuns] = useState<AdminCommandRun[]>([]);

  const loadOps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ops", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok) {
        throw new Error(`Admin ops request failed with ${response.status}`);
      }
      setOps((await response.json()) as AdminOps);
      setAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin ops");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCommands = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/commands", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { commands?: AdminCommand[] };
      setCommands(payload.commands ?? []);
    } catch {
      // Command list is auxiliary; the ops panel can still function without it.
    }
  }, []);

  useEffect(() => {
    const handleOpen = () => {
      setOpen(true);
      captureAnalyticsEvent(ANALYTICS_EVENTS.adminPanelOpened);
      void loadOps();
      void loadCommands();
    };

    window.addEventListener("mk3:open-admin-panel", handleOpen);
    return () => window.removeEventListener("mk3:open-admin-panel", handleOpen);
  }, [loadCommands, loadOps]);

  const jobs = useMemo(() => Object.values(ops?.jobs ?? {}), [ops]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/admin/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      captureAnalyticsEvent(ANALYTICS_EVENTS.adminAuthFailed);
      setError("Invalid admin password");
      return;
    }

    captureAnalyticsEvent(ANALYTICS_EVENTS.adminAuthSucceeded);
    setPassword("");
    setAuthenticated(true);
    window.setTimeout(() => {
      void loadOps();
      void loadCommands();
    }, 0);
  }

  async function runAction(action: string) {
    setRunningAction(action);
    setError(null);
    captureAnalyticsEvent(ANALYTICS_EVENTS.adminActionTriggered, { action });
    try {
      const response = await fetch(`/api/admin/actions/${action}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Action failed with ${response.status}`);
      }
      await loadOps();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin action failed");
    } finally {
      setRunningAction(null);
    }
  }

  async function runCommand(commandId: string) {
    setRunningCommand(commandId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commands/${commandId}/run`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`Command failed with ${response.status}`);
      }

      const run = (await response.json()) as AdminCommandRun;
      setCommandRuns((prev) => [run, ...prev].slice(0, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin command failed");
    } finally {
      setRunningCommand(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="h-[94dvh] !w-[96vw] !max-w-[1800px] overflow-hidden border-white/10 bg-zinc-950/95 p-0 text-zinc-100 shadow-2xl backdrop-blur-xl">
        <DialogHeader className="border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-3 font-mono text-base uppercase tracking-wide">
              <Server className="size-5 text-cyan-300" />
              Operator Console
            </DialogTitle>
            <DialogDescription className="sr-only">
              Admin-only diagnostics for backend services, Redis freshness, scheduled jobs, and manual maintenance actions.
            </DialogDescription>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        {!authenticated ? (
          <form onSubmit={submitPassword} className="mx-auto flex w-full max-w-sm flex-col gap-4 px-6 py-10">
            <div className="flex size-10 items-center justify-center rounded-md border border-white/10 bg-white/5">
              <Lock className="size-4 text-cyan-300" />
            </div>
            <div>
              <div className="text-sm font-medium">Admin password</div>
              <div className="text-muted-foreground mt-1 text-sm">
                This unlocks server-side operator routes for this browser session.
              </div>
            </div>
            <Input
              autoFocus
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="font-mono"
            />
            {error && <div className="text-sm text-rose-300">{error}</div>}
            <Button type="submit">Unlock</Button>
          </form>
        ) : (
          <div className="flex h-[calc(94dvh-65px)] flex-col overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-2">
                <StatusBadge value={ops?.status ?? "loading"} />
                <span className="text-muted-foreground font-mono text-xs">
                  {ops ? `updated ${formatTime(ops.timestamp)}` : "waiting for backend"}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={loadOps} disabled={loading}>
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>

            {error && (
              <div className="mx-6 mt-4 flex shrink-0 items-center gap-2 rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                <AlertTriangle className="size-4" />
                {error}
              </div>
            )}

            <Tabs defaultValue="overview" className="min-h-0 flex-1 gap-0 overflow-hidden px-6 py-4">
              <TabsList className="h-11 w-full justify-start rounded-md bg-white/5 p-1">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="redis">Redis</TabsTrigger>
                <TabsTrigger value="jobs">Jobs</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
                <TabsTrigger value="console">Console</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-5 min-h-0 space-y-5 overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-3">
                  {Object.entries(ops?.services ?? {}).map(([service, state]) => (
                    <div key={service} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">{service}</div>
                      <div className="mt-2"><StatusBadge value={state} /></div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Symbols" value={ops?.redis.symbolCount ?? "--"} />
                  <Metric label="Bars today" value={ops?.redis.barCount ?? "--"} />
                  <Metric label="Snapshots" value={ops?.redis.snapshotCount ?? "--"} />
                  <Metric label="Upstream subs" value={ops?.subscriptions.upstreamCount ?? "--"} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Jobs ok" value={`${ops?.jobSummary?.successfulJobs ?? "--"}/${ops?.jobSummary?.totalJobs ?? "--"}`} />
                  <Metric label="Jobs warming" value={ops?.jobSummary?.pendingJobs.length ?? "--"} />
                  <Metric label="Stream events" value={ops?.redis.streamLength ?? "--"} />
                  <Metric label="Redis memory" value={formatBytes(ops?.redis.usedMemoryBytes)} />
                </div>
              </TabsContent>

              <TabsContent value="redis" className="mt-5 min-h-0 space-y-5 overflow-y-auto pr-1">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Latest bars" value={ops?.redis.latestBarCount ?? "--"} />
                  <Metric label="Active products" value={ops?.redis.activeContractProductCount ?? "--"} />
                  <Metric label="Recovery checkpoints" value={ops?.redis.recoveryCheckpointCount ?? "--"} />
                  <Metric label="Persisted symbols" value={ops?.redis.subscribedSymbolCount ?? "--"} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Redis keys" value={ops?.redis.dbSize ?? "--"} />
                  <Metric label="Stream length" value={ops?.redis.streamLength ?? "--"} />
                  <Metric label="Snapshot index" value={ops?.redis.indexCounts?.snapshots ?? "--"} />
                  <Metric label="Contract index" value={ops?.redis.indexCounts?.activeContracts ?? "--"} />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {Object.entries(ops?.freshness ?? {}).map(([key, value]) => (
                    <div key={key} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
                      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                        <Database className="size-4 text-cyan-300" />
                        {key}
                      </div>
                      <div className="grid grid-cols-[120px_1fr] gap-2 font-mono text-sm text-zinc-300">
                        <span>newest</span>
                        <span>{formatTime(value.newestTimestamp)}</span>
                        <span>age</span>
                        <span>{formatAge(value.newestAgeMs)}</span>
                        <span>median</span>
                        <span>{formatAge(value.ageSummary?.medianAgeMs)}</span>
                        <span>oldest age</span>
                        <span>{formatAge(value.ageSummary?.maxAgeMs ?? value.oldestAgeMs)}</span>
                        <span>count</span>
                        <span>{value.ageSummary?.count ?? "--"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="jobs" className="mt-5 min-h-0 overflow-y-auto rounded-md border border-white/10">
                <div className="sticky top-0 z-10 grid grid-cols-[1.5fr_0.9fr_0.9fr_0.7fr] gap-4 border-b border-white/10 bg-zinc-900 px-4 py-3 text-xs uppercase tracking-wide text-zinc-400">
                  <span>Job</span>
                  <span>Last run</span>
                  <span>Next run</span>
                  <span>Status</span>
                </div>
                {jobs.map((job) => (
                  <div key={job.id} className="grid grid-cols-[1.5fr_0.9fr_0.9fr_0.7fr] gap-4 border-b border-white/10 px-4 py-4 text-sm last:border-b-0">
                    <div>
                      <div className="font-medium">{job.label}</div>
                      <div className="text-muted-foreground mt-1 font-mono text-xs">{job.cron} · {job.timezone}</div>
                    </div>
                    <div className="font-mono text-xs">{formatTime(job.status.lastRunTime)}</div>
                    <div className="font-mono text-xs">{formatTime(job.nextRunTime)}</div>
                    <div className="space-y-1">
                      <StatusBadge value={job.status.lastSuccess ? "ok" : "degraded"} />
                      {job.status.lastError && <div className="text-xs text-rose-300">{job.status.lastError}</div>}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="actions" className="mt-5 grid min-h-0 gap-4 overflow-y-auto pr-1 xl:grid-cols-2">
                {ACTIONS.map((action) => (
                  <div key={action.id} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Activity className="size-4 text-cyan-300" />
                          {action.label}
                        </div>
                        <div className="text-muted-foreground mt-1 text-sm">{action.description}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={Boolean(runningAction)}
                        onClick={() => runAction(action.id)}
                      >
                        {runningAction === action.id ? (
                          <Clock3 className="size-4 animate-spin" />
                        ) : (
                          <Play className="size-4" />
                        )}
                        Run
                      </Button>
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="console" className="mt-5 grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                  {commands.map((command) => (
                    <div key={command.id} className="rounded-md border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <SquareTerminal className="size-4 text-cyan-300" />
                            {command.label}
                          </div>
                          <div className="text-muted-foreground mt-1 text-sm">{command.description}</div>
                          <div className="text-muted-foreground mt-2 font-mono text-[11px]">{command.id}</div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={Boolean(runningCommand)}
                          onClick={() => runCommand(command.id)}
                        >
                          {runningCommand === command.id ? (
                            <Clock3 className="size-4 animate-spin" />
                          ) : (
                            <Play className="size-4" />
                          )}
                          Run
                        </Button>
                      </div>
                    </div>
                  ))}
                  {commands.length === 0 && (
                    <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-400">
                      No diagnostics loaded.
                    </div>
                  )}
                </div>

                <div className="flex min-h-0 flex-col rounded-md border border-white/10 bg-black/40">
                  <div className="shrink-0 border-b border-white/10 px-4 py-3 font-mono text-xs uppercase tracking-wide text-zinc-400">
                    Read-only output
                  </div>
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    {commandRuns.map((run) => (
                      <div key={run.id} className="rounded-md border border-white/10 bg-zinc-950 p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="font-mono text-sm text-cyan-200">
                            {run.command.id} · {run.durationMs}ms
                          </div>
                          <StatusBadge value={run.status} />
                        </div>
                        <pre className="whitespace-pre-wrap rounded bg-black/50 p-4 font-mono text-sm leading-relaxed text-zinc-200">
                          {run.lines.join("\n")}
                        </pre>
                        <details className="mt-3">
                          <summary className="cursor-pointer font-mono text-xs text-zinc-500">
                            JSON payload
                          </summary>
                          <pre className="mt-2 max-h-[460px] overflow-auto rounded bg-black/50 p-4 font-mono text-xs leading-relaxed text-zinc-300">
                            {JSON.stringify(run.output, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                    {commandRuns.length === 0 && (
                      <div className="flex min-h-[520px] items-center justify-center text-sm text-zinc-500">
                        Run an allowlisted diagnostic to see output here.
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
