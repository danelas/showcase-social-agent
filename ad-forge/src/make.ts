import { spawnSync } from "node:child_process";
import { basename } from "node:path";

/**
 * One command to go from brief -> finished .mp4:
 *   npm run make -- briefs/<name>.json
 * Runs generate (Veo) then remotion render.
 */
const briefPath = process.argv[2];
if (!briefPath) {
  console.error("usage: npm run make -- briefs/<name>.json");
  process.exit(1);
}
const base = basename(briefPath).replace(/\.json$/i, "");

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["tsx", "src/generate.ts", briefPath]);
run("npx", ["tsx", "src/compose.ts", `out/${base}.props.json`, `out/${base}.mp4`]);

console.log(`\n🎬 done -> out/${base}.mp4`);
