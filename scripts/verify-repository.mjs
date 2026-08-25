import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const unsafeExport = tracked.find((path) => {
  if (!path.startsWith("imports/") && !path.startsWith("exports/")) return false;
  return !path.endsWith(".gitkeep") && !path.endsWith(".enc.json") && !path.endsWith(".receipt.json");
});
if (unsafeExport) throw new Error(`Plaintext import/export artefact is tracked: ${unsafeExport}`);

const tokenPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
const privateIdentifiers = [
  "181" + "441848",
  "memory." + "drewsdigest.com",
  "cloud-memory." + "drewsdigest.com",
  "/Users/" + "drew/",
];
for (const path of tracked) {
  if (/\.(?:png|jpg|jpeg|gif|zip|lock)$/i.test(path)) continue;
  const value = readFileSync(path, "utf8");
  if (tokenPatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`High-confidence credential pattern found in tracked file: ${path}`);
  }
  if (privateIdentifiers.some((identifier) => value.includes(identifier))) {
    throw new Error(`Private deployment identifier found in publishable file: ${path}`);
  }
}

process.stdout.write("Publishable repository contains no private deployment identifiers, plaintext exports or high-confidence credential patterns.\n");
