import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  launcher as TauriLauncher,
  type TauriCapabilities,
  type TauriServiceOptions,
} from "@wdio/tauri-service";

if (process.platform !== "win32") {
  throw new Error("The embedded YTM-Free WDIO harness currently supports Windows only");
}

const originalOnPrepare = TauriLauncher.prototype.onPrepare;

if (process.platform === "win32") {
  TauriLauncher.prototype.onPrepare = async function patchedOnPrepare(config, capabilities) {
    const service = this as unknown as { options?: { driverProvider?: string } };
    if (service.options?.driverProvider !== "embedded") {
      return originalOnPrepare.call(this, config, capabilities);
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    if (!originalDescriptor) {
      throw new Error("Cannot apply embedded WDIO Windows workaround: process.platform property descriptor is missing");
    }
    if (!originalDescriptor.configurable) {
      throw new Error("Cannot apply embedded WDIO Windows workaround: process.platform is not configurable and cannot be safely redefined");
    }
    if ("get" in originalDescriptor || "set" in originalDescriptor) {
      throw new Error("Cannot apply embedded WDIO Windows workaround: process.platform is an accessor property, expected a data property");
    }

    Object.defineProperty(process, "platform", {
      value: "linux",
      writable: originalDescriptor.writable ?? true,
      enumerable: originalDescriptor.enumerable ?? true,
      configurable: true,
    });

    try {
      return await originalOnPrepare.call(this, config, capabilities);
    } finally {
      Object.defineProperty(process, "platform", originalDescriptor);
    }
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set before running the WDIO harness`);
  }
  return value;
}

function parsePort(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

function listeningPids(port: number): number[] {
  const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const pids = new Set<number>();

  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0].toUpperCase() !== "TCP" || columns[3].toUpperCase() !== "LISTENING") {
      continue;
    }

    const portMatch = columns[1].match(/:(\d+)$/);
    if (portMatch && Number(portMatch[1]) === port) {
      const pid = Number(columns[4]);
      if (Number.isSafeInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }
  }

  return [...pids].sort((left, right) => left - right);
}

function assertPortFree(port: number): void {
  const pids = listeningPids(port);
  if (pids.length > 0) {
    throw new Error(`Refusing to start WDIO: TCP port ${port} is already listening (PID ${pids.join(", ")})`);
  }
}

const dataDir = requireEnvironment("YTM_FREE_DATA_DIR");
const evidenceRoot = requireEnvironment("EVIDENCE_ROOT");
const embeddedPort = parsePort(process.env.WDIO_EMBEDDED_PORT?.trim() || "4445", "WDIO_EMBEDDED_PORT");
const appBinaryPath = path.resolve("src-tauri", "target", "debug", "ytm-free.exe");

process.env.TAURI_WEBDRIVER_PORT = String(embeddedPort);

// The config is loaded again inside WDIO workers. Only the launcher may perform
// the pre-session ownership gate; the worker sees the service-owned listener.
if (!process.env.WDIO_WORKER_ID) {
  assertPortFree(embeddedPort);
  assertPortFree(3456);

  if (!existsSync(appBinaryPath)) {
    throw new Error(`Harness binary does not exist: ${appBinaryPath}`);
  }
}

const serviceOptions: TauriServiceOptions = {
  appBinaryPath,
  driverProvider: "embedded",
  embeddedPort,
  autoInstallTauriDriver: false,
  autoDownloadEdgeDriver: false,
  captureBackendLogs: true,
  captureFrontendLogs: true,
  logDir: path.join(evidenceRoot, "wdio-logs"),
  startTimeout: 60_000,
  commandTimeout: 30_000,
  statusPollTimeout: 5_000,
  env: {
    YTM_FREE_DATA_DIR: dataDir,
    EVIDENCE_ROOT: evidenceRoot,
    WDIO_EMBEDDED_PORT: String(embeddedPort),
    TAURI_WEBDRIVER_PORT: String(embeddedPort),
  },
};

const tauriCapability: TauriCapabilities = {
  browserName: "tauri",
  "tauri:options": {
    application: appBinaryPath,
  },
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.spec.ts"],
  maxInstances: 1,
  services: [["@wdio/tauri-service", serviceOptions]],
  capabilities: [tauriCapability],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "info",
  bail: 1,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 0,
  mochaOpts: {
    ui: "bdd",
    timeout: 240_000,
  },
};
