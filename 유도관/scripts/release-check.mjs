import { execSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const withExport = args.has("--export") || args.has("--all");
const withApk = args.has("--apk") || args.has("--all");

function run(command) {
  console.log(`\n[release] ${command}`);
  execSync(command, { stdio: "inherit", shell: true });
}

function main() {
  run("pnpm run qa:checklist");
  run("pnpm run verify:release");

  if (withExport) {
    run("pnpm run export:android:member");
    run("pnpm run export:android:admin");
  }

  if (withApk) {
    run("pnpm run build:apk:member");
    run("pnpm run build:apk:admin");
  }

  console.log("\n[release] pipeline completed");
}

main();
