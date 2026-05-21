import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const configPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const bundleRoot = path.join(rootDir, "src-tauri", "target", "release", "bundle");
const args = process.argv.slice(2);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

function cleanBundleArtifacts() {
  rmSync(bundleRoot, { recursive: true, force: true });
  mkdirSync(bundleRoot, { recursive: true });
}

function readConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function finalizeBetaArtifacts() {
  const config = readConfig();
  const nsisDir = path.join(bundleRoot, "nsis");
  const msiDir = path.join(bundleRoot, "msi");
  const version = String(config.version);
  const expectedName = `GameHost-ONE-Setup-v${version}.exe`;
  const expectedPath = path.join(nsisDir, expectedName);
  const sumPath = path.join(bundleRoot, "SHA256SUMS.txt");

  if (!existsSync(nsisDir)) {
    throw new Error("NSIS bundle directory was not created.");
  }

  const exes = readdirSync(nsisDir).filter((entry) => entry.toLowerCase().endsWith(".exe"));
  if (exes.length === 0) {
    throw new Error("NSIS installer was not produced.");
  }

  const installerName = exes[0];
  const installerPath = path.join(nsisDir, installerName);
  if (installerName !== expectedName) {
    if (existsSync(expectedPath)) {
      unlinkSync(expectedPath);
    }
    renameSync(installerPath, expectedPath);
  }

  for (const entry of readdirSync(nsisDir)) {
    if (entry.toLowerCase().endsWith(".sha256")) {
      unlinkSync(path.join(nsisDir, entry));
    }
  }

  if (existsSync(sumPath)) {
    unlinkSync(sumPath);
  }

  const hash = sha256(expectedPath);
  writeFileSync(`${expectedPath}.sha256`, `${hash}  ${expectedName}\n`, "utf8");
  writeFileSync(sumPath, `${hash}  ${expectedName}\n`, "utf8");

  if (existsSync(msiDir)) {
    rmSync(msiDir, { recursive: true, force: true });
  }

  for (const entry of readdirSync(nsisDir)) {
    if (entry !== expectedName && entry !== `${expectedName}.sha256`) {
      unlinkSync(path.join(nsisDir, entry));
    }
  }
}

function getBundlesArg(cliArgs) {
  const bundlesIndex = cliArgs.indexOf("--bundles");
  if (bundlesIndex === -1 || bundlesIndex + 1 >= cliArgs.length) {
    return null;
  }
  return cliArgs[bundlesIndex + 1];
}

const isBuild = args[0] === "build";
const bundlesArg = getBundlesArg(args);
const shouldFinalizeBeta = isBuild && (bundlesArg === null || bundlesArg === "nsis");

let forwardArgs = args;
if (isBuild) {
  cleanBundleArtifacts();
  if (bundlesArg === null) {
    forwardArgs = [...args, "--bundles", "nsis"];
  }
}

const exitCode = process.platform === "win32"
  ? run("cmd.exe", ["/c", path.join(rootDir, "node_modules", ".bin", "tauri.cmd"), ...forwardArgs])
  : run(path.join(rootDir, "node_modules", ".bin", "tauri"), forwardArgs);
if (exitCode !== 0) {
  process.exit(exitCode);
}

if (shouldFinalizeBeta) {
  finalizeBetaArtifacts();
}
