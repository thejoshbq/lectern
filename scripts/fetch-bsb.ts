/**
 * Downloads the Berean Standard Bible in USJ form and extracts it to vendor/.
 *
 * The BSB is dedicated to the public domain (CC0, 30 April 2023), which is why
 * this project can index the whole text locally. Most modern translations —
 * the ESV among them — forbid storing more than a few hundred verses, which
 * makes whole-Bible retrieval legally impossible with them.
 *
 * Usage:
 *   npm run bible:fetch              # pinned release (reproducible)
 *   BSB_RELEASE=latest npm run bible:fetch
 *   npm run bible:fetch -- --force   # re-download even if cached
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { unzip } from "./lib/unzip.ts";
import { USJ_DIR, VENDOR_DIR, VENDOR_MANIFEST } from "../src/lib/paths.ts";

const REPO = "BSB-publishing/bsb2usfm";
const ASSET = "BSB_usj.zip";

// Pinned so that a rebuild months from now produces the same corpus. Override
// with BSB_RELEASE=latest to pick up a newer printing deliberately.
const PINNED_RELEASE = "v5.9";

const EXPECTED_BOOKS = 66;

interface Manifest {
  source: string;
  release: string;
  asset: string;
  sha256: string;
  books: number;
  fetchedAt: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

async function resolveRelease(release: string): Promise<GitHubRelease> {
  const url =
    release === "latest"
      ? `https://api.github.com/repos/${REPO}/releases/latest`
      : `https://api.github.com/repos/${REPO}/releases/tags/${release}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "lectern-bible-fetch",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Could not resolve release "${release}" (HTTP ${res.status}). ` +
        `Check https://github.com/${REPO}/releases`,
    );
  }

  return (await res.json()) as GitHubRelease;
}

function readManifest(): Manifest | null {
  if (!existsSync(VENDOR_MANIFEST)) return null;
  try {
    return JSON.parse(readFileSync(VENDOR_MANIFEST, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const release = process.env.BSB_RELEASE ?? PINNED_RELEASE;

  const existing = readManifest();
  if (!force && existing && existing.release === release && existsSync(USJ_DIR)) {
    console.log(
      `BSB ${existing.release} already present (${existing.books} books). ` +
        `Use --force to re-download.`,
    );
    return;
  }

  console.log(`Resolving ${REPO} @ ${release} ...`);
  const meta = await resolveRelease(release);
  const asset = meta.assets.find((a) => a.name === ASSET);

  if (!asset) {
    throw new Error(
      `Release ${meta.tag_name} has no asset named ${ASSET}. ` +
        `Available: ${meta.assets.map((a) => a.name).join(", ")}`,
    );
  }

  console.log(
    `Downloading ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB) ...`,
  );
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const archive = Buffer.from(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(archive).digest("hex");

  console.log("Extracting ...");
  const entries = unzip(archive).filter((e) => e.name.endsWith(".usj"));

  if (entries.length !== EXPECTED_BOOKS) {
    throw new Error(
      `Expected ${EXPECTED_BOOKS} books in the archive, found ${entries.length}. ` +
        `Refusing to build a partial corpus.`,
    );
  }

  rmSync(USJ_DIR, { recursive: true, force: true });
  mkdirSync(USJ_DIR, { recursive: true });

  for (const entry of entries) {
    // Flatten any directory nesting; guard against path traversal in names.
    const base = entry.name.split("/").pop();
    if (!base || base.includes("..")) {
      throw new Error(`Refusing to extract suspicious entry: ${entry.name}`);
    }
    writeFileSync(join(USJ_DIR, base), entry.data);
  }

  const manifest: Manifest = {
    source: `https://github.com/${REPO}`,
    release: meta.tag_name,
    asset: ASSET,
    sha256,
    books: entries.length,
    fetchedAt: new Date().toISOString(),
  };

  mkdirSync(VENDOR_DIR, { recursive: true });
  writeFileSync(VENDOR_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(VENDOR_DIR, ASSET), archive);

  console.log(
    `Extracted ${entries.length} books from ${meta.tag_name} to ${USJ_DIR}`,
  );
  console.log(`sha256 ${sha256}`);
}

main().catch((err) => {
  console.error(`\nfetch-bsb failed: ${err.message}`);
  process.exit(1);
});
