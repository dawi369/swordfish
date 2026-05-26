export const LIMITS = {
  // RedisTimeSeries retention
  redisTsRetentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  redisOpenTicker1sRetentionMs: 60 * 1000, // 60 seconds

  // Redis operation batching
  redisScanBatchSize: 100,
  redisDeleteBatchSize: 100,

  // Stream cap (~100 tickers × 24h of 1-min bars = 144k, set 10M for headroom)
  maxStreamLength: 10_000_000,
};
