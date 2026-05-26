import { schedules } from "@trigger.dev/sdk";

const EASTERN_TIME_ZONE = "America/New_York";
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL;

async function callBackendAdmin(path: string): Promise<unknown> {
  if (!BACKEND_BASE_URL) {
    throw new Error("BACKEND_BASE_URL is required for backend-bound Trigger.dev tasks");
  }
  const apiKey = process.env.HUB_API_KEY;
  if (!apiKey) {
    throw new Error("HUB_API_KEY is required for backend-bound Trigger.dev tasks");
  }

  const response = await fetch(new URL(path, BACKEND_BASE_URL), {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `Backend admin request failed: ${response.status} ${response.statusText} ${text}`,
    );
  }

  return body;
}

export const dailyClear = schedules.task({
  id: "daily-clear",
  cron: {
    pattern: "0 2 * * *",
    timezone: EASTERN_TIME_ZONE,
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await callBackendAdmin("/admin/clear-redis?force=false");
  },
});

export const snapshotRefresh = schedules.task({
  id: "snapshot-refresh",
  cron: {
    pattern: "5 2 * * *",
    timezone: EASTERN_TIME_ZONE,
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await callBackendAdmin("/admin/refresh-snapshots");
  },
});

export const frontMonthRefresh = schedules.task({
  id: "front-month-refresh",
  cron: {
    pattern: "0 3 * * *",
    timezone: EASTERN_TIME_ZONE,
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await callBackendAdmin("/admin/refresh-front-months");
  },
});

export const subscriptionRefresh = schedules.task({
  id: "subscription-refresh",
  cron: {
    pattern: "5 0 1 * *",
    timezone: EASTERN_TIME_ZONE,
    environments: ["PRODUCTION"],
  },
  run: async () => {
    return await callBackendAdmin("/admin/refresh-subscriptions");
  },
});
