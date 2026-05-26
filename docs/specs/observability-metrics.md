# Observability Metrics

## Goal

Swordfish emits structured metric logs that can be ingested by Datadog or another
log-derived metrics backend without adding an in-process Datadog client.

Every metric log is emitted as a normal backend log line with:

- `metric`
- `metricType`
- `value`
- `tags`
- `timestamp`

## Metric Catalog

| Metric | Type | Key Tags | Purpose |
|---|---|---|---|
| `swordfish.admin_ops.status` | gauge | `status`, `redis`, `timescale_enabled`, `timescale_connected`, `massive_ws` | backend operator health and durable-store connectivity |
| `swordfish.data_coverage.stale_symbols` | gauge | none currently | stale symbol count from admin coverage |
| `swordfish.data_coverage.spike_symbols` | gauge | none currently | symbols with durable spike counts |
| `swordfish.market_data.write_success` | counter | `symbol`, `durable` | successful live write fanout |
| `swordfish.market_data.write_partial_failure` | counter | `symbol`, `redis`, `recovery`, `durable` | partial write failures across Redis/recovery/durable paths |
| `swordfish.market_data.durable_write` | counter | `source`, `durable` | durable live and future flat-file write attempts |
| `swordfish.market_data.durable_bars` | gauge | `source` | bars written through the durable ingestion boundary |
| `swordfish.market_data.durable_range_failure` | counter | `symbol`, `tf` | durable range fallback failed; Redis/empty response served instead |
| `swordfish.market_data.durable_quality_failure` | counter | `symbol`, `tf` | durable quality summary failed; range response used local bar-quality fallback |
| `swordfish.tool.range_quality_record_failure` | counter | `symbol`, `tf` | tool range read stayed usable but durable quality-summary audit recording failed |
| `swordfish.redis.client_error` | counter | `code` | Redis client connection/runtime errors; Sentry captures are throttled to avoid outage spam |
| `swordfish.provider_fetch.outcome` | counter | `provider`, `source`, `symbol`, `timeframe`, `status` | legacy/manual provider diagnostic outcome rate; provider REST backfill is disabled for current production futures history |
| `swordfish.provider_fetch.bars` | gauge | `provider`, `source`, `symbol`, `timeframe` | bars returned by legacy/manual provider diagnostics |
| `swordfish.provider_fetch.run_symbols` | gauge | `source`, `status` | symbols attempted in legacy/manual provider diagnostics |
| `swordfish.provider_contract_fetch.run` | counter | `provider`, `root`, `status`, `http_status` | contract-provider success, empty, and failure rates |
| `swordfish.provider_contract_fetch.contracts` | gauge | `provider`, `root` | active contracts returned by the contract provider |
| `swordfish.admin_command.run` | counter | `command`, `status` | admin diagnostic/repair command usage |
| `swordfish.admin_action.started` | counter | `action` | direct admin mutation start rate |
| `swordfish.admin_action.run` | counter | `action`, `status` | direct admin mutation completion status |
| `swordfish.open_ticker.set` | counter | `action` | open-ticker set/clear mutations |
| `swordfish.job.run_started` | counter | `job_name`, `trigger` | scheduled/manual job start rate with job-specific tags |
| `swordfish.job.run` | counter | `job_name`, `status`, `trigger` | scheduled/manual job completion status |
| `swordfish.job.duration_ms` | distribution | `job_name`, `status`, `trigger` | scheduled/manual job runtime duration |
| `swordfish.hot_cache_rebuild.startup` | counter | `status` | startup hot-cache rebuild success/failure |
| `swordfish.hot_cache_rebuild.bars_loaded` | gauge | `trigger` | bars loaded from durable storage into Redis during rebuild |
| `swordfish.operational_run.recorded` | counter | `run_type`, `name`, `status`, `trigger` | operational run state transitions |
| `swordfish.operational_run.duration_ms` | distribution | `run_type`, `name`, `status`, `trigger` | operational run durations |

## Dashboard Panels

- Durable store connected:
  `swordfish.admin_ops.status` grouped by `timescale_connected`.
- Market data partial write failures:
  count of `swordfish.market_data.write_partial_failure` grouped by `durable`,
  `redis`, and `recovery`.
- Durable range fallback failures:
  count of `swordfish.market_data.durable_range_failure` grouped by `symbol` and `tf`.
- Durable quality fallback failures:
  count of `swordfish.market_data.durable_quality_failure` and
  `swordfish.tool.range_quality_record_failure` grouped by `symbol` and `tf`.
- Stale symbol count:
  latest `swordfish.data_coverage.stale_symbols`.
- Spike symbol count:
  latest `swordfish.data_coverage.spike_symbols`.
- Provider empty/failed outcome rate:
  count of `swordfish.provider_fetch.outcome` grouped by `status`.
- Provider contract failures:
  count of `swordfish.provider_contract_fetch.run` grouped by `root`, `status`,
  and `http_status`.
- Redis client errors:
  count of `swordfish.redis.client_error` grouped by `code`.
- Admin repair usage:
  count of `swordfish.admin_command.run` grouped by `command` and `status`, plus
  `swordfish.admin_action.run` grouped by `action` and `status`.
- Scheduled job outcomes:
  count of `swordfish.job.run` grouped by `job_name`, `trigger`, and `status`.
- Operational run failures:
  count of `swordfish.operational_run.recorded` where `status=failed`, grouped by
  `run_type` and `name`.

## Initial Monitor Rules

- Durable store disconnected:
  alert when `swordfish.admin_ops.status` reports `timescale_enabled=true` and
  `timescale_connected=false` for multiple consecutive checks.
- Live write partial failures:
  alert on any sustained `swordfish.market_data.write_partial_failure`.
- Durable range degradation:
  warn when `swordfish.market_data.durable_range_failure` is non-zero for symbols that
  should have durable history.
- Durable quality degradation:
  warn when `swordfish.market_data.durable_quality_failure` or
  `swordfish.tool.range_quality_record_failure` is non-zero over a rolling window.
- Provider failures:
  alert when `swordfish.provider_fetch.outcome{status=failed}` is non-zero over a
  backfill window.
- Provider contract failures:
  alert when `swordfish.provider_contract_fetch.run{status=failed}` is non-zero
  during snapshot/front-month/subscription refresh windows.
- Redis client errors:
  alert on sustained `swordfish.redis.client_error` counts.
- Provider empty spike:
  warn when `swordfish.provider_fetch.outcome{status=empty}` increases sharply for
  active subscribed symbols.
- Operational run failures:
  alert when `swordfish.operational_run.recorded{status=failed}` is emitted for
  scheduled jobs, recovery, or admin actions.
- Stale symbols:
  warn when `swordfish.data_coverage.stale_symbols` remains above zero during an
  expected market/session window.

## Sentry Correlation

High-value Sentry events should include tags such as:

- `run_id`
- `job_name`
- `symbol`
- `ingestion_source`
- `provider`
- `recovery_source`

The incident trace should be:

1. Sentry event.
2. `run_id` tag.
3. `operational_runs` durable row.
4. `provider_fetch_outcomes` and affected symbol coverage.
