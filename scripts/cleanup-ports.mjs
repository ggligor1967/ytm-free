/**
 * Cleanup script: kills stale processes on ports used by YTM Free.
 * Runs automatically before `npm run dev` to prevent ERR_CONNECTION_REFUSED.
 *
 * Ports:
 *   5173 - Vite dev server
 *   3456 - Rust stream server
 */

import { execSync } from 'child_process';

const PORTS = [5173, 3456];
const isWindows = process.platform === 'win32';

function killProcessOnPort(port) {
  try {
    if (isWindows) {
      // Find PID listening on port
      const output = execSync(
        `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const pids = new Set();
      for (const line of output.trim().split('\n')) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== '0') pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
          console.log(`[cleanup] Killed stale process PID ${pid} on port ${port}`);
        } catch { /* already dead */ }
      }
    } else {
      // macOS / Linux
      const output = execSync(
        `lsof -ti:${port}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      for (const pid of output.trim().split('\n').filter(Boolean)) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
          console.log(`[cleanup] Killed stale process PID ${pid} on port ${port}`);
        } catch { /* already dead */ }
      }
    }
  } catch {
    // No process on this port — all good
  }
}

for (const port of PORTS) {
  killProcessOnPort(port);
}
