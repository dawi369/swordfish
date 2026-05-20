import { MASSIVE_API_KEY } from "@/config/env.js";
import { MASSIVE_WS_URL } from "@/utils/consts.js";
import type {
  MassiveWsRequest,
  MassiveMarketType,
  MassiveStatusMessage,
} from "@/types/massive.types.js";
import {
  buildSubscribeParams,
  isAggregateEvent,
  isStatusMessage,
  isQuoteEvent,
  isTradeEvent,
  aggregateToBar,
} from "@/utils/massive.utils.js";
import { MassiveAggregateEventSchema } from "@/schemas/events.js";
import { ConnectionState } from "@/types/massive.types.js";
import type { WSHealth } from "@/types/massive.types.js";
import { isMarketHours } from "@/utils/massive.utils.js";
import { recoveryService } from "@/services/recovery_service.js";
import { marketDataWriter } from "@/services/market_data_writer.js";
import type { Bar } from "@/types/common.types.js";

// Timeout configuration (ms)
const WS_TIMEOUT = {
  AUTH: 15000,
  SUBSCRIBE: 15000,
  UNSUBSCRIBE: 10000,
} as const;

const WS_LIVENESS = {
  CHECK_INTERVAL_MS: 15_000,
  STALE_AFTER_MS: 90_000,
} as const;

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

export class MassiveWSClient {
  private ws: WebSocket | null = null;
  private health: WSHealth = {
    connected: false,
    lastMessageTime: null,
    subscriptionCount: 0,
    latencyMs: null,
  };

  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private market: MassiveMarketType | null = null;
  private subscriptions: MassiveWsRequest[] = [];
  private lastDisconnectAt: number | null = null;
  private recoveryPhase: "idle" | "buffering" | "flushing" = "idle";
  private recoveryBuffer: Bar[] = [];
  private authResolver: (() => void) | null = null;
  private subscribeResolver: (() => void) | null = null;
  private unsubscribeResolver: (() => void) | null = null;

  async connect(marketType: MassiveMarketType): Promise<void> {
    this.market = marketType;
    this.state = ConnectionState.CONNECTING;

    console.log(`Connecting to Massive ${marketType}...`);

    const marketStatus = isMarketHours();
    if (!marketStatus.isOpen) {
      console.warn(
        `⚠️  Market closed: ${marketStatus.reason}. No live data expected.`,
      );
    }

    // Build the WebSocket URL with market type path
    const wsUrl = `${MASSIVE_WS_URL}/${marketType}`;
    this.ws = new WebSocket(wsUrl);

    // Create a promise that resolves when authenticated
    const authPromise = new Promise<void>((resolve) => {
      this.authResolver = resolve;
    });

    this.ws.onopen = () => {
      // Send auth message immediately after connection opens
      this.ws?.send(
        JSON.stringify({ action: "auth", params: MASSIVE_API_KEY }),
      );
    };

    this.ws.onmessage = (msg: MessageEvent) => {
      const statusMessage = this.handleMessage(msg);
      if (statusMessage) {
        // console.log("Connect status message:", statusMessage);
      }
    };

    this.ws.onerror = (err: Event) => {
      console.error("WebSocket error:", err);
      this.health.connected = false;
      this.state = ConnectionState.DISCONNECTED;
    };

    this.ws.onclose = (event: CloseEvent) => {
      const wasLive =
        this.state === ConnectionState.SUBSCRIBED ||
        this.state === ConnectionState.CONNECTED;
      console.log(`Connection closed: ${event.code} ${event.reason}`);
      this.health.connected = false;
      this.state = ConnectionState.DISCONNECTED;
      if (wasLive) {
        this.lastDisconnectAt = Date.now();
      }
      this.scheduleReconnect();
    };

    // Wait for authentication before returning (with timeout)
    await withTimeout(authPromise, WS_TIMEOUT.AUTH, "Massive authentication");
  }

  private handleMessage(msg: MessageEvent): MassiveStatusMessage | void {
    this.health.lastMessageTime = Date.now();

    const data = JSON.parse(msg.data as string);
    const messages = Array.isArray(data) ? data : [data];

    let statusMessage: MassiveStatusMessage | undefined;

    messages.forEach((m) => {
      // Handle status messages
      if (isStatusMessage(m)) {
        console.log(`Status: ${m.status} - ${m.message || ""}`);

        if (m.status === "auth_success") {
          this.health.connected = true;
          this.state = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          this.startLivenessMonitor();

          // Resolve the auth promise to allow connect() to return
          if (this.authResolver) {
            this.authResolver();
            this.authResolver = null;
          }
        }

        // Check for subscription confirmation
        if (m.status === "success" && m.message?.includes("subscribed to:")) {
          this.state = ConnectionState.SUBSCRIBED;
          this.health.connected = true;
          this.startLivenessMonitor();
          // Resolve the subscribe promise
          if (this.subscribeResolver) {
            this.subscribeResolver();
            this.subscribeResolver = null;
          }
        }

        // Check for unsubscription confirmation
        if (m.status === "success" && m.message?.includes("unsubscribed to:")) {
          // Resolve the unsubscribe promise
          if (this.unsubscribeResolver) {
            this.unsubscribeResolver();
            this.unsubscribeResolver = null;
          }
        }

        statusMessage = m;
        return;
      }

      // Handle aggregate events (bars)
      if (isAggregateEvent(m)) {
        // Validate with Zod
        const validation = MassiveAggregateEventSchema.safeParse(m);
        if (!validation.success) {
          console.error("Invalid aggregate event:", validation.error);
          return;
        }

        this.handleAggregateBar(aggregateToBar(validation.data));

        return;
      }

      // Handle quote events (top of book)
      if (isQuoteEvent(m)) {
        console.log(
          `Quote: ${m.sym} - Bid: ${m.bp}x${m.bs}, Ask: ${m.ap}x${m.as}`,
        );
        return;
      }

      // Handle trade events
      if (isTradeEvent(m)) {
        console.log(`Trade: ${m.sym} - Price: ${m.p}, Size: ${m.s}`);
        return;
      }

      // Unknown message type
      console.log("Unknown message type:", m);
    });

    return statusMessage;
  }

  async subscribe(request: MassiveWsRequest): Promise<void> {
    // Save subscription for reconnects (deduplicate)
    if (
      !this.subscriptions.find(
        (s) =>
          s.ev === request.ev &&
          JSON.stringify(s.symbols) === JSON.stringify(request.symbols),
      )
    ) {
      this.subscriptions.push(request);
    }

    const params = buildSubscribeParams(request);
    console.log("Subscribing to:", params);

    // Create a promise that resolves when subscription is confirmed
    const subscribePromise = new Promise<void>((resolve) => {
      this.subscribeResolver = resolve;
    });

    this.ws?.send(
      JSON.stringify({
        action: "subscribe",
        params,
      }),
    );

    this.health.subscriptionCount = request.symbols.length;

    // Wait for subscription confirmation before returning (with timeout)
    await withTimeout(
      subscribePromise,
      WS_TIMEOUT.SUBSCRIBE,
      `Subscribe to ${request.symbols.length} symbols`,
    );
  }

  async unsubscribe(request: MassiveWsRequest): Promise<void> {
    if (!this.ws || this.state === ConnectionState.DISCONNECTED) {
      console.log("Cannot unsubscribe: not connected");
      // Still remove from local tracking
      this.subscriptions = this.subscriptions.filter(
        (s) =>
          !(
            s.ev === request.ev &&
            JSON.stringify(s.symbols) === JSON.stringify(request.symbols)
          ),
      );
      return;
    }

    const params = buildSubscribeParams(request);
    console.log("Unsubscribing from:", params);

    // Create a promise that resolves when unsubscription is confirmed
    const unsubscribePromise = new Promise<void>((resolve) => {
      this.unsubscribeResolver = resolve;
    });

    this.ws.send(
      JSON.stringify({
        action: "unsubscribe",
        params,
      }),
    );

    // Wait for unsubscription confirmation (with timeout)
    await withTimeout(
      unsubscribePromise,
      WS_TIMEOUT.UNSUBSCRIBE,
      `Unsubscribe from ${request.symbols.length} symbols`,
    );

    // Remove from tracked subscriptions
    this.subscriptions = this.subscriptions.filter(
      (s) =>
        !(
          s.ev === request.ev &&
          JSON.stringify(s.symbols) === JSON.stringify(request.symbols)
        ),
    );

    // Update subscription count
    this.health.subscriptionCount = this.subscriptions.reduce(
      (total, sub) => total + sub.symbols.length,
      0,
    );
  }

  async updateSubscription(
    old: MassiveWsRequest,
    newRequest: MassiveWsRequest,
  ): Promise<void> {
    const oldSymbols = old.symbols.sort().join(",");
    const newSymbols = newRequest.symbols.sort().join(",");

    if (oldSymbols === newSymbols && old.ev === newRequest.ev) {
      console.log("No subscription change needed - symbols unchanged");
      return;
    }

    console.log(
      `Updating subscription: ${old.symbols.length} symbols → ${newRequest.symbols.length} symbols`,
    );

    // Unsubscribe from old
    await this.unsubscribe(old);

    // Subscribe to new with retry logic
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.subscribe(newRequest);
        console.log(`Subscription updated successfully`);
        return;
      } catch (err) {
        console.error(
          `Subscribe attempt ${attempt}/${maxRetries} failed:`,
          err,
        );

        if (attempt === maxRetries) {
          throw new Error(
            `Failed to subscribe after ${maxRetries} attempts: ${err}`,
          );
        }

        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await Bun.sleep(delay);
      }
    }
  }

  getSubscriptions(): MassiveWsRequest[] {
    return [...this.subscriptions];
  }

  getSubscribedSymbols(): string[] {
    return Array.from(
      new Set(this.subscriptions.flatMap((subscription) => subscription.symbols)),
    );
  }

  isConnected(): boolean {
    return this.health.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.state = ConnectionState.DISCONNECTED;
  }

  async getHealth(): Promise<WSHealth> {
    await this.measureLatency();
    return { ...this.health };
  }

  private async measureLatency(): Promise<void> {
    try {
      const start = Date.now();

      const response = await fetch(
        `https://api.massive.com/v3/reference/tickers?active=true&limit=1&apiKey=${MASSIVE_API_KEY}`,
      );

      if (response.ok) {
        const end = Date.now();
        this.health.latencyMs = end - start;
      } else {
        console.error("Latency check failed with status:", response.status);
        this.health.latencyMs = null;
      }
    } catch (err) {
      console.error("Failed to measure latency:", err);
      this.health.latencyMs = null;
    }
  }

  private startLivenessMonitor(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkConnectionLiveness();
    }, WS_LIVENESS.CHECK_INTERVAL_MS);
  }

  private stopLivenessMonitor(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private checkConnectionLiveness(nowMs = Date.now()): void {
    if (this.state !== ConnectionState.SUBSCRIBED) {
      return;
    }

    if (this.subscriptions.length === 0) {
      return;
    }

    const lastMessageTime = this.health.lastMessageTime;
    if (!lastMessageTime) {
      return;
    }

    const marketStatus = isMarketHours();
    if (!marketStatus.isOpen) {
      return;
    }

    if (nowMs - lastMessageTime <= WS_LIVENESS.STALE_AFTER_MS) {
      return;
    }

    console.warn(
      `[MassiveWSClient] Connection stale for ${nowMs - lastMessageTime}ms during market hours; forcing reconnect`,
    );
    this.forceReconnect();
  }

  private forceReconnect(): void {
    if (this.state === ConnectionState.RECONNECTING) {
      return;
    }

    const wasLive =
      this.state === ConnectionState.SUBSCRIBED ||
      this.state === ConnectionState.CONNECTED;

    if (wasLive) {
      this.lastDisconnectAt = Date.now();
    }

    this.health.connected = false;
    this.state = ConnectionState.DISCONNECTED;
    this.stopLivenessMonitor();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.state === ConnectionState.RECONNECTING) {
      return;
    }

    if (
      this.state === ConnectionState.SUBSCRIBED ||
      this.state === ConnectionState.CONNECTED
    ) {
      return;
    }

    this.state = ConnectionState.RECONNECTING;

    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts), 20_000);

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    if (!this.market) {
      console.error("Cannot reconnect: market type not saved");
      return;
    }

    console.log("Attempting reconnect...");
    this.recoveryPhase = "buffering";
    this.recoveryBuffer = [];
    this.stopLivenessMonitor();

    // Clean up old connection before creating new one
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    await this.connect(this.market);

    for (const sub of this.subscriptions) {
      await this.subscribe(sub);
    }

    try {
      const recoveryResults = await recoveryService.backfillSymbolsFromProvider(
        this.getSubscribedSymbols(),
        {
          source: "reconnect",
          disconnectedAt: this.lastDisconnectAt,
          excludeCurrentMinute: true,
        },
      );
      const recoveredBars = recoveryResults.reduce(
        (sum, result) => sum + result.providerBars,
        0,
      );
      const flushedBars = await this.flushBufferedBars();
      console.log(
        `[Recovery] Reconnect gap-fill applied ${recoveredBars} provider bars and flushed ${flushedBars} buffered live bars`,
      );
    } catch (error) {
      console.error("[Recovery] Reconnect gap-fill failed:", error);
      const flushedBars = await this.flushBufferedBars();
      console.log(
        `[Recovery] Flushed ${flushedBars} buffered live bars after recovery failure`,
      );
    } finally {
      this.lastDisconnectAt = null;
    }
  }

  private handleAggregateBar(bar: Bar): void {
    if (this.recoveryPhase !== "idle") {
      this.recoveryBuffer.push(bar);
      return;
    }

    void this.persistAggregateBar(bar);
  }

  private async persistAggregateBar(bar: Bar): Promise<void> {
    const result = await marketDataWriter.writeLiveBar(bar);

    if (result.errors.redis) {
      console.error("Redis write failed:", result.errors.redis);
    }
    if (result.errors.recovery) {
      console.error("Recovery store write failed:", result.errors.recovery);
    }
    if (result.errors.durable) {
      console.error("Durable bar write failed:", result.errors.durable);
    }
  }

  private async flushBufferedBars(): Promise<number> {
    let flushedCount = 0;
    this.recoveryPhase = "flushing";

    while (this.recoveryBuffer.length > 0) {
      const batch = this.normalizeBufferedBars(this.recoveryBuffer);
      this.recoveryBuffer = [];

      for (const bar of batch) {
        await this.persistAggregateBar(bar);
        flushedCount++;
      }

      await Bun.sleep(0);
    }

    this.recoveryPhase = "idle";
    return flushedCount;
  }

  private normalizeBufferedBars(bars: Bar[]): Bar[] {
    const uniqueBars = new Map<string, Bar>();

    for (const bar of bars) {
      uniqueBars.set(`${bar.symbol}:${bar.startTime}`, bar);
    }

    return Array.from(uniqueBars.values()).sort((left, right) => {
      if (left.startTime !== right.startTime) {
        return left.startTime - right.startTime;
      }
      return left.symbol.localeCompare(right.symbol);
    });
  }
}
