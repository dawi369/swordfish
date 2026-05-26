import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

const project = process.env.TRIGGER_PROJECT_REF ?? "proj_zxdiyvcgdmoxjfnbyzzh";

function requireDeployEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required when deploying Trigger.dev tasks`);
  }
  return value;
}

export default defineConfig({
  project,
  runtime: "bun",
  maxDuration: 600,
  dirs: ["./src/trigger"],
  tsconfig: "./tsconfig.json",
  build: {
    extensions: [
      syncEnvVars(async () => [
        {
          name: "BACKEND_BASE_URL",
          value: requireDeployEnv("BACKEND_BASE_URL"),
        },
        {
          name: "HUB_API_KEY",
          value: requireDeployEnv("HUB_API_KEY"),
        },
      ]),
    ],
  },
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 30_000,
      maxTimeoutInMs: 120_000,
      factor: 2,
      randomize: true,
    },
  },
});
