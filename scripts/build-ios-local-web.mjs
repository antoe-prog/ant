import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function argValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function validateApiOrigin(value) {
  assert(value, "Pass --api-origin=<https-origin> or set FINAL_JUDO_IOS_API_ORIGIN.");
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "iOS API origin must use HTTPS.");
  assert(!/[<>]|TODO|TBD|placeholder|example|localhost/i.test(value), "iOS API origin must be a real production host.");
  return url.origin;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${output.split(/\r?\n/).slice(-80).join("\n")}`));
    });
  });
}

async function listFiles(root) {
  const files = [];

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  await walk(root);
  return files;
}

const projectRoot = process.cwd();
const apiOrigin = validateApiOrigin(
  argValue("--api-origin") ?? process.env.FINAL_JUDO_IOS_API_ORIGIN ?? process.env.FINAL_JUDO_IOS_SERVER_URL,
);
const destination = path.resolve(argValue("--out-dir") ?? "mobile/ios-web");
const reportPath = path.resolve(argValue("--report") ?? ".data/mobile-builds/ios/ios-local-web-report.json");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "final-judo-ios-web-"));

try {
  for (const fileName of ["next-env.d.ts", "next.config.ts", "package.json", "package-lock.json", "postcss.config.mjs", "tsconfig.json"]) {
    await cp(path.join(projectRoot, fileName), path.join(temporaryRoot, fileName));
  }

  await cp(path.join(projectRoot, "public"), path.join(temporaryRoot, "public"), { recursive: true });
  await cp(path.join(projectRoot, "src"), path.join(temporaryRoot, "src"), {
    recursive: true,
    filter(source) {
      const relative = path.relative(projectRoot, source);
      return relative !== path.join("src", "app", "api") &&
        !relative.startsWith(`${path.join("src", "app", "api")}${path.sep}`) &&
        relative !== path.join("src", "app", "(auth)", "invite") &&
        !relative.startsWith(`${path.join("src", "app", "(auth)", "invite")}${path.sep}`) &&
        relative !== path.join("src", "app", "(app)", "app", "promotions", "[promotionId]") &&
        !relative.startsWith(`${path.join("src", "app", "(app)", "app", "promotions", "[promotionId]")}${path.sep}`);
    },
  });

  const nodeModulesPath = path.join(projectRoot, "node_modules");
  assert((await lstat(nodeModulesPath)).isDirectory(), "node_modules is required before building the iOS web bundle.");
  await symlink(nodeModulesPath, path.join(temporaryRoot, "node_modules"), "dir");

  await run(
    process.execPath,
    [path.join(nodeModulesPath, "next", "dist", "bin", "next"), "build", "--webpack"],
    {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        FINAL_JUDO_IOS_LOCAL_BUNDLE: "1",
        FINAL_JUDO_NEXT_DIST_DIR: "",
        FINAL_JUDO_NEXT_TSCONFIG_PATH: "",
        NEXT_PUBLIC_FINAL_JUDO_API_ORIGIN: apiOrigin,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );

  const exportDirectory = path.join(temporaryRoot, "out");
  const requiredFiles = [
    "index.html",
    path.join("login", "index.html"),
    path.join("app", "dashboard", "index.html"),
    path.join("app", "classes", "index.html"),
    path.join("app", "payments", "checkout", "index.html"),
    path.join("app", "promotions", "certificate", "index.html"),
  ];

  for (const relativePath of requiredFiles) {
    assert((await lstat(path.join(exportDirectory, relativePath))).isFile(), `Missing bundled iOS route: ${relativePath}`);
  }

  const exportedFiles = await listFiles(exportDirectory);
  const indexHtml = await readFile(path.join(exportDirectory, "index.html"), "utf8");
  assert(!indexHtml.includes("FINAL_JUDO_IOS_SERVER_URL"), "The operator fallback page must not ship as the iOS UI.");
  assert(exportedFiles.some((file) => file.includes(`${path.sep}_next${path.sep}static${path.sep}`)), "Bundled Next.js assets are missing.");

  await rm(destination, { force: true, recursive: true });
  await cp(exportDirectory, destination, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    ok: true,
    generatedAt: new Date().toISOString(),
    distributionMode: "bundled_web_ui",
    apiOrigin,
    destination,
    fileCount: exportedFiles.length,
    requiredRoutes: requiredFiles,
  }, null, 2)}\n`);

  console.log(JSON.stringify({ ok: true, apiOrigin, destination, fileCount: exportedFiles.length, reportPath }, null, 2));
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
