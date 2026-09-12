import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function ensureBuildLock() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (process.env.PSTACK_BUILD_LOCK === root) return;
  const child = spawnSync("python3", [resolve(root, "build/build_lock.py"),
    process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit" });
  if (child.error) console.error(`Cannot acquire the build lock: ${child.error.message}`);
  process.exit(child.status ?? 1);
}
