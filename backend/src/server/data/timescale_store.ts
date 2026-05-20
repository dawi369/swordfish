import postgres from "postgres";
import { promisify } from "util";
import { gzip, unzip } from "zlib";
import { redisStore } from "@/server/data/redis_store.js";
import { buildBarQualityFlags } from "@/services/data_quality.js";
import type { Bar } from "@/types/common.types.js";
import type { OperationalRunRecord } from "@/types/operational.types.js";
import {
  DATA_QUALITY_GAP_THRESHOLD_MS,
  DATA_QUALITY_SPIKE_THRESHOLD_PCT,
  DATABASE_URL,
} from "@/config/env.js";

const gzipAsync = promisify(gzip);
const unzipAsync = promisify(unzip);

export type BarIngestionSource =
  | "live_ws"
  | "provider_rest"
  | "flat_file"
  | "recovery";

export interface DurableSymbolStats {
  symbol: string;
  barCount: number;
  firstBarTs: number | null;
  lastBarTs: number | null;
  gapCount: number;
  spikeCount: number;
}

export interface DurableStoreStats {
  enabled: boolean;
  connected: boolean;
  timescaleAvailable: boolean;
  bars1m: {
    symbolCount: number;
    barCount: number;
    oldestBarTs: number | null;
    newestBarTs: number | null;
  };
  symbols: DurableSymbolStats[];
}

export interface DurableLatestBarRecord extends Bar {
  source: string;
  qualityFlags: Record<string, unknown>;
  ingestedAt: number | null;
}

export interface DurableQualitySummary {
  symbol: string;
  startMs: number;
  endMs: number;
  summaryId?: string;
  gapThresholdMs?: number;
  spikeThresholdPct?: number;
  barCount: number;
  gapCount: number;
  spikeCount: number;
  invalidOhlcCount: number;
  zeroVolumeCount: number;
  negativeVolumeCount: number;
  oldestBarTs: number | null;
  newestBarTs: number | null;
  recordedAt?: number | null;
}

export interface ProviderFetchOutcomeRecord {
  outcomeId: string;
  provider: string;
  source: string;
  symbol: string;
  timeframe: string;
  status: "success" | "empty" | "failed";
  startMs: number;
  endMs: number;
  barCount: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StoredProviderFetchOutcomeRecord extends ProviderFetchOutcomeRecord {
  createdAt: number;
}

export interface IngestionRunRecord {
  runId: string;
  source: Exclude<BarIngestionSource, "live_ws">;
  status: "started" | "success" | "failed";
  startedAt: number;
  completedAt?: number | null;
  symbolCount: number;
  barCount: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StoredIngestionRunRecord extends IngestionRunRecord {
  createdAt: number;
  updatedAt: number;
}

class TimescaleStore {
  private sql: postgres.Sql | null = null;
  private connected = false;
  private timescaleAvailable = false;
  private readonly enabled =
    Boolean(DATABASE_URL) &&
    Bun.env.ENABLE_TIMESCALE !== "false" &&
    Bun.env.DISABLE_DURABLE_STORE !== "true";

  constructor() {}

  get isConnected(): boolean {
    return this.connected;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get hasTimescale(): boolean {
    return this.timescaleAvailable;
  }

  /**
   * Ping the database to verify connection is alive
   */
  async ping(): Promise<boolean> {
    if (!this.sql || !this.connected) return false;
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async init() {
    if (!this.enabled) {
      console.warn(
        "Durable Postgres init skipped for current runtime (DATABASE_URL missing or durable store explicitly disabled)",
      );
      return;
    }

    if (!DATABASE_URL) {
      console.warn("DATABASE_URL not set, skipping TimescaleDB init");
      return;
    }

    try {
      this.sql = postgres(DATABASE_URL, {
        max: 20, // Max connections
        idle_timeout: 30, // Idle timeout in seconds
      });

      // Suppress NOTICE messages (like "relation already exists") at session level
      await this.sql`SET client_min_messages TO WARNING`;

      // Test connection
      await this.sql`SELECT 1`;
      this.timescaleAvailable = await this.detectTimescale();
      console.log(
        this.timescaleAvailable
          ? "Connected to durable Postgres store with TimescaleDB support"
          : "Connected to durable Postgres store without TimescaleDB support",
      );

      // Initialize Schema
      await this.sql`
        CREATE TABLE IF NOT EXISTS bars (
          symbol TEXT NOT NULL,
          open DOUBLE PRECISION NOT NULL,
          high DOUBLE PRECISION NOT NULL,
          low DOUBLE PRECISION NOT NULL,
          close DOUBLE PRECISION NOT NULL,
          volume DOUBLE PRECISION NOT NULL,
          vwap DOUBLE PRECISION NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          UNIQUE (symbol, timestamp)
        );
      `;

      if (this.timescaleAvailable) {
        await this.createHypertableIfAvailable("bars", "timestamp");
      }

      // Create index on symbol for faster queries
      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_bars_symbol_time ON bars (symbol, timestamp DESC);
      `;

      await this.sql`
        CREATE TABLE IF NOT EXISTS bars_1m (
          symbol TEXT NOT NULL,
          ts TIMESTAMPTZ NOT NULL,
          open DOUBLE PRECISION NOT NULL,
          high DOUBLE PRECISION NOT NULL,
          low DOUBLE PRECISION NOT NULL,
          close DOUBLE PRECISION NOT NULL,
          volume DOUBLE PRECISION NOT NULL,
          trades INTEGER NOT NULL,
          dollar_volume DOUBLE PRECISION,
          source TEXT NOT NULL,
          quality_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
          ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (symbol, ts)
        );
      `;

      await this.sql`
        ALTER TABLE bars_1m
        ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '{}'::jsonb;
      `;

      if (this.timescaleAvailable) {
        await this.createHypertableIfAvailable("bars_1m", "ts");
      }

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_bars_1m_symbol_ts
        ON bars_1m (symbol, ts DESC);
      `;

      await this.sql`
        CREATE TABLE IF NOT EXISTS ingestion_runs (
          run_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          symbol_count INTEGER NOT NULL DEFAULT 0,
          bar_count INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source_started
        ON ingestion_runs (source, started_at DESC);
      `;

      await this.sql`
        CREATE TABLE IF NOT EXISTS provider_fetch_outcomes (
          outcome_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          source TEXT NOT NULL,
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          status TEXT NOT NULL,
          start_ts TIMESTAMPTZ,
          end_ts TIMESTAMPTZ,
          bar_count INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_provider_fetch_outcomes_symbol_created
        ON provider_fetch_outcomes (symbol, created_at DESC);
      `;

      await this.sql`
        CREATE TABLE IF NOT EXISTS data_quality_summaries (
          summary_id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          start_ts TIMESTAMPTZ NOT NULL,
          end_ts TIMESTAMPTZ NOT NULL,
          gap_threshold_ms INTEGER NOT NULL,
          spike_threshold_pct DOUBLE PRECISION NOT NULL,
          bar_count INTEGER NOT NULL DEFAULT 0,
          gap_count INTEGER NOT NULL DEFAULT 0,
          spike_count INTEGER NOT NULL DEFAULT 0,
          invalid_ohlc_count INTEGER NOT NULL DEFAULT 0,
          zero_volume_count INTEGER NOT NULL DEFAULT 0,
          negative_volume_count INTEGER NOT NULL DEFAULT 0,
          oldest_bar_ts TIMESTAMPTZ,
          newest_bar_ts TIMESTAMPTZ,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_data_quality_summaries_symbol_recorded
        ON data_quality_summaries (symbol, recorded_at DESC);
      `;

      if (this.timescaleAvailable) {
        await this.createContinuousAggregatesIfAvailable();
      }

      await this.sql`
        CREATE TABLE IF NOT EXISTS operational_runs (
          run_id TEXT PRIMARY KEY,
          run_type TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          trigger TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          duration_ms INTEGER,
          counts JSONB NOT NULL DEFAULT '{}'::jsonb,
          error TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_operational_runs_type_name_started
        ON operational_runs (run_type, name, started_at DESC);
      `;

      await this.sql`
        CREATE INDEX IF NOT EXISTS idx_operational_runs_status_started
        ON operational_runs (status, started_at DESC);
      `;

      this.connected = true;
      console.log("Durable market-data schema initialized");
    } catch (err: any) {
      console.error("Failed to initialize TimescaleDB:", err);
      if (err.code === "ECONNREFUSED") {
        console.error(
          "❌ TimescaleDB connection refused. Is the 'timescaledb' container running? (docker compose up -d timescaledb)",
        );
      }
      this.connected = false;
    }
  }

  private async detectTimescale(): Promise<boolean> {
    if (!this.sql) return false;

    try {
      const [row] = await this.sql<{ available: boolean }[]>`
        SELECT to_regproc('create_hypertable') IS NOT NULL AS available;
      `;
      return Boolean(row?.available);
    } catch {
      return false;
    }
  }

  private async createHypertableIfAvailable(
    tableName: "bars" | "bars_1m",
    timeColumn: "timestamp" | "ts",
  ): Promise<void> {
    if (!this.sql || !this.timescaleAvailable) return;

    await this.sql`
      SELECT create_hypertable(
        ${tableName},
        ${timeColumn},
        if_not_exists => TRUE
      );
    `;
  }

  private async createContinuousAggregatesIfAvailable(): Promise<void> {
    if (!this.sql || !this.timescaleAvailable) return;

    await this.sql`
      CREATE MATERIALIZED VIEW IF NOT EXISTS bars_30m
      WITH (timescaledb.continuous) AS
      SELECT
        symbol,
        time_bucket('30 minutes', ts) AS bucket,
        first(open, ts) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, ts) AS close,
        sum(volume) AS volume,
        sum(trades) AS trades,
        sum(dollar_volume) AS dollar_volume
      FROM bars_1m
      GROUP BY symbol, bucket;
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_bars_30m_symbol_time
      ON bars_30m (symbol, bucket DESC);
    `;
  }

  async insertBar(bar: Bar) {
    if (!this.isConnected || !this.sql) return;

    const vwap =
      bar.dollarVolume && bar.volume
        ? bar.dollarVolume / bar.volume
        : bar.close;
    const timestamp = new Date(bar.startTime);

    try {
      await this.sql`
        INSERT INTO bars (symbol, open, high, low, close, volume, vwap, timestamp)
        VALUES (${bar.symbol}, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.volume}, ${vwap}, ${timestamp})
        ON CONFLICT (symbol, timestamp) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          vwap = EXCLUDED.vwap;
      `;
    } catch (err) {
      console.error(`Failed to insert bar for ${bar.symbol}:`, err);
    }
  }

  async upsertBars1m(
    bars: Bar[],
    source: BarIngestionSource = "live_ws",
  ): Promise<number> {
    if (!this.isConnected || !this.sql || bars.length === 0) return 0;

    const rows = bars.map((bar) => ({
      symbol: bar.symbol,
      ts: new Date(bar.startTime),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      trades: bar.trades,
      dollar_volume: bar.dollarVolume ?? null,
      source,
      quality_flags: JSON.stringify(buildBarQualityFlags(bar)),
    }));

    try {
      await this.sql`
        INSERT INTO bars_1m ${this.sql(rows)}
        ON CONFLICT (symbol, ts) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          trades = EXCLUDED.trades,
          dollar_volume = EXCLUDED.dollar_volume,
          source = EXCLUDED.source,
          quality_flags = EXCLUDED.quality_flags,
          ingested_at = NOW();
      `;
      return rows.length;
    } catch (err) {
      console.error(`bars_1m upsert failed (${bars.length} bars):`, err);
      throw err;
    }
  }

  async upsertBar1m(
    bar: Bar,
    source: BarIngestionSource = "live_ws",
  ): Promise<number> {
    return await this.upsertBars1m([bar], source);
  }

  async getBars1mRange(
    symbol: string,
    startMs: number,
    endMs: number,
  ): Promise<Bar[]> {
    if (!this.isConnected || !this.sql) return [];

    const rows = await this.sql`
      SELECT
        symbol,
        open,
        high,
        low,
        close,
        volume,
        trades,
        dollar_volume,
        extract(epoch from ts) * 1000 AS start_time
      FROM bars_1m
      WHERE symbol = ${symbol}
        AND ts >= ${new Date(startMs)}
        AND ts <= ${new Date(endMs)}
      ORDER BY ts ASC;
    `;

    return rows.map((row) => {
      const startTime = Number(row.start_time);
      return {
        symbol: row.symbol as string,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        trades: Number(row.trades),
        dollarVolume:
          row.dollar_volume === null || row.dollar_volume === undefined
            ? undefined
            : Number(row.dollar_volume),
        startTime,
        endTime: startTime + 60_000,
      };
    });
  }

  async getRecentDurableSymbols(limit = 100): Promise<DurableSymbolStats[]> {
    const stats = await this.getDurableStats([], {
      startMs: 0,
      endMs: Date.now(),
    });

    return stats.symbols
      .sort((left, right) => (right.lastBarTs ?? 0) - (left.lastBarTs ?? 0))
      .slice(0, limit);
  }

  async getLatestDurableBars(
    symbols: string[] = [],
    limit = 100,
    source?: BarIngestionSource,
  ): Promise<DurableLatestBarRecord[]> {
    if (!this.isConnected || !this.sql) return [];

    const uniqueSymbols = Array.from(new Set(symbols)).sort();
    const rows = await this.sql<
      Array<{
        symbol: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        trades: number;
        dollar_volume: number | null;
        source: string;
        quality_flags: Record<string, unknown> | null;
        start_time: string | number;
        ingested_at: Date | null;
      }>
    >`
      WITH ranked AS (
        SELECT
          symbol,
          ts,
          open,
          high,
          low,
          close,
          volume,
          trades,
          dollar_volume,
          source,
          quality_flags,
          ingested_at,
          row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) AS rank
        FROM bars_1m
        WHERE TRUE
          ${uniqueSymbols.length > 0 ? this.sql`AND symbol = ANY(${uniqueSymbols})` : this.sql``}
          ${source ? this.sql`AND source = ${source}` : this.sql``}
      )
      SELECT
        symbol,
        open,
        high,
        low,
        close,
        volume,
        trades,
        dollar_volume,
        source,
        quality_flags,
        extract(epoch from ts) * 1000 AS start_time,
        ingested_at
      FROM ranked
      WHERE rank = 1
      ORDER BY ts DESC
      LIMIT ${limit};
    `;

    return rows.map((row) => {
      const startTime = Number(row.start_time);
      return {
        symbol: row.symbol,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        trades: Number(row.trades),
        dollarVolume:
          row.dollar_volume === null || row.dollar_volume === undefined
            ? undefined
            : Number(row.dollar_volume),
        startTime,
        endTime: startTime + 60_000,
        source: row.source,
        qualityFlags: row.quality_flags ?? {},
        ingestedAt: row.ingested_at?.getTime() ?? null,
      };
    });
  }

  async getProviderFetchOutcomes(options: {
    symbol?: string;
    status?: ProviderFetchOutcomeRecord["status"];
    limit?: number;
  } = {}): Promise<StoredProviderFetchOutcomeRecord[]> {
    if (!this.isConnected || !this.sql) return [];

    const rows = await this.sql<
      Array<{
        outcome_id: string;
        provider: string;
        source: string;
        symbol: string;
        timeframe: string;
        status: ProviderFetchOutcomeRecord["status"];
        start_ts: Date | null;
        end_ts: Date | null;
        bar_count: number;
        error: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
      }>
    >`
      SELECT
        outcome_id,
        provider,
        source,
        symbol,
        timeframe,
        status,
        start_ts,
        end_ts,
        bar_count,
        error,
        metadata,
        created_at
      FROM provider_fetch_outcomes
      WHERE TRUE
        ${options.symbol ? this.sql`AND symbol = ${options.symbol}` : this.sql``}
        ${options.status ? this.sql`AND status = ${options.status}` : this.sql``}
      ORDER BY created_at DESC
      LIMIT ${options.limit ?? 100};
    `;

    return rows.map((row) => ({
      outcomeId: row.outcome_id,
      provider: row.provider,
      source: row.source,
      symbol: row.symbol,
      timeframe: row.timeframe,
      status: row.status,
      startMs: row.start_ts?.getTime() ?? 0,
      endMs: row.end_ts?.getTime() ?? 0,
      barCount: Number(row.bar_count),
      error: row.error,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.getTime(),
    }));
  }

  async getOperationalRuns(options: {
    runType?: string;
    status?: string;
    limit?: number;
  } = {}): Promise<OperationalRunRecord[]> {
    if (!this.isConnected || !this.sql) return [];

    const rows = await this.sql<
      Array<{
        run_id: string;
        run_type: string;
        name: string;
        status: OperationalRunRecord["status"];
        trigger: string;
        started_at: Date;
        completed_at: Date | null;
        duration_ms: number | null;
        counts: Record<string, number> | null;
        error: string | null;
        metadata: Record<string, unknown> | null;
      }>
    >`
      SELECT
        run_id,
        run_type,
        name,
        status,
        trigger,
        started_at,
        completed_at,
        duration_ms,
        counts,
        error,
        metadata
      FROM operational_runs
      WHERE TRUE
        ${options.runType ? this.sql`AND run_type = ${options.runType}` : this.sql``}
        ${options.status ? this.sql`AND status = ${options.status}` : this.sql``}
      ORDER BY started_at DESC
      LIMIT ${options.limit ?? 100};
    `;

    return rows.map((row) => ({
      runId: row.run_id,
      runType: row.run_type as OperationalRunRecord["runType"],
      name: row.name,
      status: row.status,
      trigger: row.trigger,
      startedAt: row.started_at.getTime(),
      completedAt: row.completed_at?.getTime() ?? null,
      durationMs: row.duration_ms,
      counts: row.counts ?? {},
      error: row.error,
      metadata: row.metadata ?? {},
    }));
  }

  async getIngestionRuns(options: {
    source?: Exclude<BarIngestionSource, "live_ws">;
    status?: IngestionRunRecord["status"];
    limit?: number;
  } = {}): Promise<StoredIngestionRunRecord[]> {
    if (!this.isConnected || !this.sql) return [];

    const rows = await this.sql<
      Array<{
        run_id: string;
        source: Exclude<BarIngestionSource, "live_ws">;
        status: IngestionRunRecord["status"];
        started_at: Date;
        completed_at: Date | null;
        symbol_count: string | number;
        bar_count: string | number;
        error: string | null;
        metadata: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT
        run_id,
        source,
        status,
        started_at,
        completed_at,
        symbol_count,
        bar_count,
        error,
        metadata,
        created_at,
        updated_at
      FROM ingestion_runs
      WHERE TRUE
        ${options.source ? this.sql`AND source = ${options.source}` : this.sql``}
        ${options.status ? this.sql`AND status = ${options.status}` : this.sql``}
      ORDER BY started_at DESC
      LIMIT ${options.limit ?? 100};
    `;

    return rows.map((row) => ({
      runId: row.run_id,
      source: row.source,
      status: row.status,
      startedAt: row.started_at.getTime(),
      completedAt: row.completed_at?.getTime() ?? null,
      symbolCount: Number(row.symbol_count),
      barCount: Number(row.bar_count),
      error: row.error,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
    }));
  }

  async getDurableQualitySummary(
    symbol: string,
    startMs: number,
    endMs: number,
    options: {
      gapThresholdMs?: number;
      spikeThresholdPct?: number;
      recordSummary?: boolean;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<DurableQualitySummary> {
    const gapThresholdMs =
      options.gapThresholdMs ?? DATA_QUALITY_GAP_THRESHOLD_MS;
    const spikeThresholdPct =
      options.spikeThresholdPct ?? DATA_QUALITY_SPIKE_THRESHOLD_PCT;
    const [stats] = (await this.getDurableStats([symbol], {
      startMs,
      endMs,
      gapThresholdMs,
      spikeThresholdPct,
    })).symbols;

    const empty: DurableQualitySummary = {
      symbol,
      startMs,
      endMs,
      summaryId: this.buildQualitySummaryId(
        symbol,
        startMs,
        endMs,
        gapThresholdMs,
        spikeThresholdPct,
      ),
      gapThresholdMs,
      spikeThresholdPct,
      barCount: stats?.barCount ?? 0,
      gapCount: stats?.gapCount ?? 0,
      spikeCount: stats?.spikeCount ?? 0,
      invalidOhlcCount: 0,
      zeroVolumeCount: 0,
      negativeVolumeCount: 0,
      oldestBarTs: stats?.firstBarTs ?? null,
      newestBarTs: stats?.lastBarTs ?? null,
      recordedAt: null,
    };

    if (!this.isConnected || !this.sql) return empty;

    const [row] = await this.sql<
      Array<{
        invalid_ohlc_count: string | number;
        zero_volume_count: string | number;
        negative_volume_count: string | number;
      }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE quality_flags->>'invalidOhlc' = 'true') AS invalid_ohlc_count,
        COUNT(*) FILTER (WHERE quality_flags->>'zeroVolume' = 'true') AS zero_volume_count,
        COUNT(*) FILTER (WHERE quality_flags->>'negativeVolume' = 'true') AS negative_volume_count
      FROM bars_1m
      WHERE symbol = ${symbol}
        AND ts >= ${new Date(startMs)}
        AND ts <= ${new Date(endMs)};
    `;

    const summary = {
      ...empty,
      invalidOhlcCount: Number(row?.invalid_ohlc_count ?? 0),
      zeroVolumeCount: Number(row?.zero_volume_count ?? 0),
      negativeVolumeCount: Number(row?.negative_volume_count ?? 0),
    };

    if (options.recordSummary) {
      await this.recordDurableQualitySummary(summary, options.metadata);
      return {
        ...summary,
        recordedAt: Date.now(),
      };
    }

    return summary;
  }

  private buildQualitySummaryId(
    symbol: string,
    startMs: number,
    endMs: number,
    gapThresholdMs: number,
    spikeThresholdPct: number,
  ): string {
    return [
      "quality",
      symbol,
      startMs,
      endMs,
      gapThresholdMs,
      spikeThresholdPct,
    ].join(":");
  }

  async recordDurableQualitySummary(
    summary: DurableQualitySummary,
    metadata: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!this.isConnected || !this.sql) return false;

    const summaryId =
      summary.summaryId ??
      this.buildQualitySummaryId(
        summary.symbol,
        summary.startMs,
        summary.endMs,
        summary.gapThresholdMs ?? DATA_QUALITY_GAP_THRESHOLD_MS,
        summary.spikeThresholdPct ?? DATA_QUALITY_SPIKE_THRESHOLD_PCT,
      );

    try {
      await this.sql`
        INSERT INTO data_quality_summaries (
          summary_id,
          symbol,
          start_ts,
          end_ts,
          gap_threshold_ms,
          spike_threshold_pct,
          bar_count,
          gap_count,
          spike_count,
          invalid_ohlc_count,
          zero_volume_count,
          negative_volume_count,
          oldest_bar_ts,
          newest_bar_ts,
          metadata,
          recorded_at
        )
        VALUES (
          ${summaryId},
          ${summary.symbol},
          ${new Date(summary.startMs)},
          ${new Date(summary.endMs)},
          ${summary.gapThresholdMs ?? DATA_QUALITY_GAP_THRESHOLD_MS},
          ${summary.spikeThresholdPct ?? DATA_QUALITY_SPIKE_THRESHOLD_PCT},
          ${summary.barCount},
          ${summary.gapCount},
          ${summary.spikeCount},
          ${summary.invalidOhlcCount},
          ${summary.zeroVolumeCount},
          ${summary.negativeVolumeCount},
          ${summary.oldestBarTs !== null ? new Date(summary.oldestBarTs) : null},
          ${summary.newestBarTs !== null ? new Date(summary.newestBarTs) : null},
          ${JSON.stringify(metadata)}::jsonb,
          NOW()
        )
        ON CONFLICT (summary_id) DO UPDATE SET
          bar_count = EXCLUDED.bar_count,
          gap_count = EXCLUDED.gap_count,
          spike_count = EXCLUDED.spike_count,
          invalid_ohlc_count = EXCLUDED.invalid_ohlc_count,
          zero_volume_count = EXCLUDED.zero_volume_count,
          negative_volume_count = EXCLUDED.negative_volume_count,
          oldest_bar_ts = EXCLUDED.oldest_bar_ts,
          newest_bar_ts = EXCLUDED.newest_bar_ts,
          metadata = EXCLUDED.metadata,
          recorded_at = NOW();
      `;
      return true;
    } catch (err) {
      console.error(`Failed to record quality summary ${summaryId}:`, err);
      return false;
    }
  }

  /**
   * Batch insert bars for efficient bulk loading
   */
  async insertBatch(bars: Bar[]) {
    if (!this.isConnected || !this.sql || bars.length === 0) return;

    try {
      const data = bars.map((bar) => ({
        symbol: bar.symbol,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap:
          bar.dollarVolume && bar.volume
            ? bar.dollarVolume / bar.volume
            : bar.close,
        timestamp: new Date(bar.startTime),
      }));

      await this.sql`
        INSERT INTO bars ${this.sql(data)}
        ON CONFLICT (symbol, timestamp) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          vwap = EXCLUDED.vwap;
      `;
    } catch (err) {
      console.error(`Batch insert failed (${bars.length} bars):`, err);
      throw err;
    }
  }

  async recordOperationalRun(record: OperationalRunRecord): Promise<boolean> {
    if (!this.isConnected || !this.sql) return false;

    try {
      const startedAt = new Date(record.startedAt);
      const completedAt = record.completedAt ? new Date(record.completedAt) : null;
      const counts = JSON.stringify(record.counts ?? {});
      const metadata = JSON.stringify(record.metadata ?? {});

      await this.sql`
        INSERT INTO operational_runs (
          run_id,
          run_type,
          name,
          status,
          trigger,
          started_at,
          completed_at,
          duration_ms,
          counts,
          error,
          metadata,
          updated_at
        )
        VALUES (
          ${record.runId},
          ${record.runType},
          ${record.name},
          ${record.status},
          ${record.trigger},
          ${startedAt},
          ${completedAt},
          ${record.durationMs ?? null},
          ${counts}::jsonb,
          ${record.error ?? null},
          ${metadata}::jsonb,
          NOW()
        )
        ON CONFLICT (run_id) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          duration_ms = EXCLUDED.duration_ms,
          counts = EXCLUDED.counts,
          error = EXCLUDED.error,
          metadata = EXCLUDED.metadata,
          updated_at = NOW();
      `;

      return true;
    } catch (err) {
      console.error(`Failed to record operational run ${record.runId}:`, err);
      return false;
    }
  }

  async recordIngestionRun(record: IngestionRunRecord): Promise<boolean> {
    if (!this.isConnected || !this.sql) return false;

    try {
      const startedAt = new Date(record.startedAt);
      const completedAt = record.completedAt ? new Date(record.completedAt) : null;

      await this.sql`
        INSERT INTO ingestion_runs (
          run_id,
          source,
          status,
          started_at,
          completed_at,
          symbol_count,
          bar_count,
          error,
          metadata,
          updated_at
        )
        VALUES (
          ${record.runId},
          ${record.source},
          ${record.status},
          ${startedAt},
          ${completedAt},
          ${record.symbolCount},
          ${record.barCount},
          ${record.error ?? null},
          ${JSON.stringify(record.metadata ?? {})}::jsonb,
          NOW()
        )
        ON CONFLICT (run_id) DO UPDATE SET
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          symbol_count = EXCLUDED.symbol_count,
          bar_count = EXCLUDED.bar_count,
          error = EXCLUDED.error,
          metadata = EXCLUDED.metadata,
          updated_at = NOW();
      `;

      return true;
    } catch (err) {
      console.error(`Failed to record ingestion run ${record.runId}:`, err);
      return false;
    }
  }

  async recordProviderFetchOutcome(
    record: ProviderFetchOutcomeRecord,
  ): Promise<boolean> {
    if (!this.isConnected || !this.sql) return false;

    try {
      await this.sql`
        INSERT INTO provider_fetch_outcomes (
          outcome_id,
          provider,
          source,
          symbol,
          timeframe,
          status,
          start_ts,
          end_ts,
          bar_count,
          error,
          metadata
        )
        VALUES (
          ${record.outcomeId},
          ${record.provider},
          ${record.source},
          ${record.symbol},
          ${record.timeframe},
          ${record.status},
          ${new Date(record.startMs)},
          ${new Date(record.endMs)},
          ${record.barCount},
          ${record.error ?? null},
          ${JSON.stringify(record.metadata ?? {})}::jsonb
        )
        ON CONFLICT (outcome_id) DO NOTHING;
      `;

      return true;
    } catch (err) {
      console.error(
        `Failed to record provider fetch outcome ${record.outcomeId}:`,
        err,
      );
      return false;
    }
  }

  async getDurableStats(
    symbols: string[] = [],
    options: {
      startMs?: number;
      endMs?: number;
      gapThresholdMs?: number;
      spikeThresholdPct?: number;
    } = {},
  ): Promise<DurableStoreStats> {
    const empty: DurableStoreStats = {
      enabled: this.isEnabled,
      connected: this.isConnected,
      timescaleAvailable: this.timescaleAvailable,
      bars1m: {
        symbolCount: 0,
        barCount: 0,
        oldestBarTs: null,
        newestBarTs: null,
      },
      symbols: [],
    };

    if (!this.isConnected || !this.sql) {
      return empty;
    }

    const uniqueSymbols = Array.from(new Set(symbols)).sort();
    const startDate = new Date(options.startMs ?? 0);
    const endDate = new Date(options.endMs ?? Date.now());
    const gapThresholdMs =
      options.gapThresholdMs ?? DATA_QUALITY_GAP_THRESHOLD_MS;
    const spikeThresholdPct =
      options.spikeThresholdPct ?? DATA_QUALITY_SPIKE_THRESHOLD_PCT;

    const [global] = await this.sql<
      Array<{
        symbol_count: string | number;
        bar_count: string | number;
        oldest_bar_ts: Date | null;
        newest_bar_ts: Date | null;
      }>
    >`
      SELECT
        COUNT(DISTINCT symbol) AS symbol_count,
        COUNT(*) AS bar_count,
        MIN(ts) AS oldest_bar_ts,
        MAX(ts) AS newest_bar_ts
      FROM bars_1m
      WHERE ts >= ${startDate}
        AND ts <= ${endDate}
        ${uniqueSymbols.length > 0 ? this.sql`AND symbol = ANY(${uniqueSymbols})` : this.sql``};
    `;

    const rows = await this.sql<
      Array<{
        symbol: string;
        bar_count: string | number;
        first_bar_ts: Date | null;
        last_bar_ts: Date | null;
        gap_count: string | number;
        spike_count: string | number;
      }>
    >`
      WITH ordered AS (
        SELECT
          symbol,
          ts,
          close,
          lag(ts) OVER (PARTITION BY symbol ORDER BY ts) AS prev_ts,
          lag(close) OVER (PARTITION BY symbol ORDER BY ts) AS prev_close
        FROM bars_1m
        WHERE ts >= ${startDate}
          AND ts <= ${endDate}
          ${uniqueSymbols.length > 0 ? this.sql`AND symbol = ANY(${uniqueSymbols})` : this.sql``}
      )
      SELECT
        symbol,
        COUNT(*) AS bar_count,
        MIN(ts) AS first_bar_ts,
        MAX(ts) AS last_bar_ts,
        COUNT(*) FILTER (
          WHERE prev_ts IS NOT NULL
            AND EXTRACT(EPOCH FROM (ts - prev_ts)) * 1000 > ${gapThresholdMs}
        ) AS gap_count,
        COUNT(*) FILTER (
          WHERE prev_close IS NOT NULL
            AND prev_close <> 0
            AND ABS((close - prev_close) / prev_close) > ${spikeThresholdPct}
        ) AS spike_count
      FROM ordered
      GROUP BY symbol
      ORDER BY symbol ASC;
    `;

    return {
      enabled: this.isEnabled,
      connected: this.isConnected,
      timescaleAvailable: this.timescaleAvailable,
      bars1m: {
        symbolCount: Number(global?.symbol_count ?? 0),
        barCount: Number(global?.bar_count ?? 0),
        oldestBarTs: global?.oldest_bar_ts?.getTime() ?? null,
        newestBarTs: global?.newest_bar_ts?.getTime() ?? null,
      },
      symbols: rows.map((row) => ({
        symbol: row.symbol,
        barCount: Number(row.bar_count),
        firstBarTs: row.first_bar_ts?.getTime() ?? null,
        lastBarTs: row.last_bar_ts?.getTime() ?? null,
        gapCount: Number(row.gap_count),
        spikeCount: Number(row.spike_count),
      })),
    };
  }

  /**
   * Get history with Read-Through Caching
   * 1. Split request into monthly chunks
   * 2. For past months: Check Redis -> If miss, Query DB & Cache
   * 3. For current month: Query DB directly (no long-term cache)
   * 4. Combine and filter
   */
  async getHistory(
    symbol: string,
    startMs: number,
    endMs: number,
  ): Promise<Bar[]> {
    if (!this.isConnected || !this.sql) return [];

    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();

    const chunks: Bar[] = [];

    // Iterate month by month
    let iterYear = startDate.getUTCFullYear();
    let iterMonth = startDate.getUTCMonth();

    while (
      iterYear < endDate.getUTCFullYear() ||
      (iterYear === endDate.getUTCFullYear() &&
        iterMonth <= endDate.getUTCMonth())
    ) {
      const isCurrentMonth =
        iterYear === currentYear && iterMonth === currentMonth;
      const monthKey = `history:${symbol}:${iterYear}-${(iterMonth + 1)
        .toString()
        .padStart(2, "0")}`;

      let monthBars: Bar[] = [];

      if (!isCurrentMonth) {
        // Try Redis first for past months
        try {
          const cached = await redisStore.redis.get(monthKey);
          if (cached) {
            // Decompress
            const buffer = Buffer.from(cached, "base64");
            const unzipped = await unzipAsync(buffer);
            monthBars = JSON.parse(unzipped.toString());
          }
        } catch (err) {
          console.error(`Cache read failed for ${monthKey}:`, err);
        }
      }

      // If not in cache (or is current month), query DB
      if (monthBars.length === 0) {
        // Calculate month start/end
        const monthStart = new Date(Date.UTC(iterYear, iterMonth, 1));
        const monthEnd = new Date(
          Date.UTC(iterYear, iterMonth + 1, 0, 23, 59, 59, 999),
        );

        try {
          const result = await this.sql`
            SELECT 
              symbol,
              open,
              high,
              low,
              close,
              volume,
              vwap,
              extract(epoch from timestamp) * 1000 as timestamp
            FROM bars
            WHERE symbol = ${symbol} 
            AND timestamp >= ${monthStart}
            AND timestamp <= ${monthEnd}
            ORDER BY timestamp ASC;
          `;

          monthBars = result.map((row) => {
            const startTime = Number(row.timestamp);
            return {
              symbol: row.symbol as string,
              open: row.open as number,
              high: row.high as number,
              low: row.low as number,
              close: row.close as number,
              volume: row.volume as number,
              trades: 0, // Not stored in DB currently
              dollarVolume: (row.volume as number) * (row.vwap as number),
              startTime: startTime,
              endTime: startTime + 60000, // Assume 1-minute bars
            };
          });

          // Cache if it's a past month and we found data
          if (!isCurrentMonth && monthBars.length > 0) {
            const jsonStr = JSON.stringify(monthBars);
            const zipped = await gzipAsync(jsonStr);
            // Store as base64 string
            await redisStore.redis.set(monthKey, zipped.toString("base64"));
            // No expiry for history (or set very long, e.g. 1 year)
            // await redisStore.redis.expire(monthKey, 60 * 60 * 24 * 365);
          }
        } catch (err) {
          console.error(
            `DB query failed for ${symbol} ${iterYear}-${iterMonth}:`,
            err,
          );
        }
      }

      chunks.push(...monthBars);

      // Next month
      iterMonth++;
      if (iterMonth > 11) {
        iterMonth = 0;
        iterYear++;
      }
    }

    // Filter exact range
    return chunks.filter((b) => b.startTime >= startMs && b.startTime <= endMs);
  }

  async close() {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
    }
    this.connected = false;
  }
}

export const timescaleStore = new TimescaleStore();
