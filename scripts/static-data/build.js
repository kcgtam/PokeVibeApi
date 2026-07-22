import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchTabData, mapWithConcurrency, defaultConfig } from "./lib/fetch.js";
import { validateTabData, validateManifest, validateLatest } from "./lib/validate.js";
import { stableStringify, toBytes, sha256Hex, shortHash } from "./lib/hash.js";
import {
  r2ConfigFromEnv,
  hasR2Credentials,
  createR2Client,
  uploadImmutable,
  uploadLatest,
  publicUrl,
} from "./lib/r2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const POKEMON_COUNT = 151;
export const DATA_VERSION_PREFIX = "data/v1";

/**
 * Resolve the local output root from the environment at call time (not module
 * load time) so tests can redirect output to a temp directory.
 */
function resolveOutputRoot() {
  return path.resolve(
    process.env.STATIC_DATA_OUTPUT_ROOT ||
      path.join(__dirname, "..", "..", ".generated", "pokevibe-data")
  );
}

/**
 * Build (and optionally publish) static Pokémon data.
 *
 * @param {object} opts
 * @param {boolean} opts.publish - If true, upload to R2. If false, dry-run only.
 * @param {object} [opts.fetchConfig] - Override fetch config (used by tests).
 * @param {number[]} [opts.ids] - Override IDs (used by tests to simulate failure).
 * @returns {Promise<object>} summary
 */
export async function buildStaticData({
  publish = false,
  fetchConfig = defaultConfig(),
  ids = Array.from({ length: POKEMON_COUNT }, (_, i) => i + 1),
  // Optional uploader injection (used by tests). When provided, `publish`
  // routes through these instead of real R2. Each is async (key, bytes) => url.
  uploader = null,
} = {}) {
  const failed = [];
  const pokemonOutputs = new Map(); // id -> { data, bytes, hash, fileName, key, dataUrl }
  let totalBytes = 0;

  console.log(`[static-data] source: ${fetchConfig.apiBaseUrl}`);
  console.log(`[static-data] concurrency: ${fetchConfig.concurrency}`);
  console.log(`[static-data] ids: ${ids.length}`);

  // ---- 1. Fetch + validate ----
  // Fail-fast: if any Pokémon cannot be fetched/validated, abort the whole build
  // and never publish latest.json.
  const rawResults = await mapWithConcurrency(ids, fetchConfig.concurrency, async (id) => {
    const data = await fetchTabData(id, fetchConfig);
    validateTabData(data, id);
    return { id, data };
  });

  // Build deterministic per-Pokémon files.
  for (const { id, data } of rawResults) {
    // Preserve existing normalized response shape (incl. `cached` if present).
    const bytes = toBytes(data);
    const hash = shortHash(bytes);
    const padded = String(id).padStart(3, "0");
    const fileName = `${padded}.${hash}.json`;
    const key = `${DATA_VERSION_PREFIX}/pokemon/${fileName}`;
    pokemonOutputs.set(id, {
      id,
      data,
      bytes,
      hash,
      fileName,
      key,
    });
    totalBytes += bytes.length;
  }

  console.log(`[static-data] fetched+validated ${pokemonOutputs.size}/${ids.length}`);

  // ---- 2. Build core manifest ----
  const sortedIds = [...pokemonOutputs.keys()].sort((a, b) => a - b);
  const pokemonEntries = sortedIds.map((id) => {
    const o = pokemonOutputs.get(id);
    return {
      id: o.data.id,
      name: o.data.name,
      displayName: o.data.displayName,
      types: o.data.types,
      ability: o.data.ability ?? null,
      stats: o.data.stats,
      artwork: o.data.artwork,
    };
  });

  // Wait until now to compute dataUrls so they reference the actual hash.
  const r2cfg = r2ConfigFromEnv();
  for (const id of sortedIds) {
    const o = pokemonOutputs.get(id);
    o.dataUrl = publicUrl(r2cfg, o.key);
  }

  const dataVersion = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const generatedAt = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    dataVersion,
    generatedAt,
    pokemonCount: POKEMON_COUNT,
    pokemon: pokemonEntries.map((entry) => {
      const o = pokemonOutputs.get(entry.id);
      return { ...entry, dataUrl: o.dataUrl };
    }),
  };

  // Validate manifest shape & dataUrl consistency.
  const pokemonById = new Map(
    [...pokemonOutputs.values()].map((o) => [o.id, { dataUrl: o.dataUrl }])
  );
  validateManifest(manifest, pokemonById);

  const manifestBytes = toBytes(manifest);
  const manifestHash = shortHash(manifestBytes);
  const manifestFullHash = sha256Hex(manifestBytes);
  const manifestFileName = `manifest.${manifestHash}.json`;
  const manifestKey = `${DATA_VERSION_PREFIX}/${manifestFileName}`;
  const manifestUrl = publicUrl(r2cfg, manifestKey);

  console.log(`[static-data] manifest: ${manifestFileName} (${manifestBytes.length} bytes)`);

  // ---- 3. Build latest.json (do not upload yet) ----
  const latest = {
    schemaVersion: 1,
    dataVersion,
    generatedAt,
    pokemonCount: POKEMON_COUNT,
    manifestUrl,
    manifestHash: manifestFullHash,
  };
  validateLatest(latest, manifestUrl, manifestFullHash);

  const latestBytes = toBytes(latest);
  const latestKey = `${DATA_VERSION_PREFIX}/latest.json`;

  // ---- 4. Write local output (both modes) ----
  const OUTPUT_ROOT = resolveOutputRoot();
  await fs.rm(OUTPUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(OUTPUT_ROOT, DATA_VERSION_PREFIX, "pokemon"), {
    recursive: true,
  });

  for (const o of pokemonOutputs.values()) {
    await fs.writeFile(path.join(OUTPUT_ROOT, o.key), o.bytes);
  }
  await fs.writeFile(path.join(OUTPUT_ROOT, manifestKey), manifestBytes);
  await fs.writeFile(path.join(OUTPUT_ROOT, latestKey), latestBytes);

  // Persist a small index so tests/CI can resolve generated files without scanning.
  const index = {
    dataVersion,
    generatedAt,
    manifestKey,
    manifestUrl,
    manifestHash,
    manifestFullHash,
    latestKey,
    pokemonCount: POKEMON_COUNT,
    pokemon: [...pokemonOutputs.values()]
      .sort((a, b) => a.id - b.id)
      .map((o) => ({ id: o.id, key: o.key, hash: o.hash, dataUrl: o.dataUrl })),
  };
  await fs.writeFile(path.join(OUTPUT_ROOT, "index.json"), toBytes(index));

  console.log(`[static-data] local output: ${OUTPUT_ROOT}`);

  // ---- 5. Publish (optional) ----
  let uploadedCount = 0;
  let latestPublished = false;

  if (publish) {
    const useRealR2 = !uploader;
    let client = null;
    if (useRealR2) {
      if (!hasR2Credentials(r2cfg)) {
        throw new Error(
          "publish=true but R2 credentials missing. Set R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY."
        );
      }
      client = createR2Client(r2cfg);
    }

    const doImmutable = useRealR2
      ? (key, bytes) => uploadImmutable(client, r2cfg, key, bytes)
      : (key, bytes) => uploader.uploadImmutable(key, bytes);
    const doLatest = useRealR2
      ? (key, bytes) => uploadLatest(client, r2cfg, key, bytes)
      : (key, bytes) => uploader.uploadLatest(key, bytes);

    // Upload ALL immutable Pokémon files first.
    for (const id of sortedIds) {
      const o = pokemonOutputs.get(id);
      await doImmutable(o.key, o.bytes);
      uploadedCount += 1;
      if (id % 25 === 0 || id === sortedIds[sortedIds.length - 1]) {
        console.log(
          `[static-data] uploaded ${uploadedCount}/${POKEMON_COUNT} pokemon files`
        );
      }
    }

    // Then upload the manifest.
    await doImmutable(manifestKey, manifestBytes);
    uploadedCount += 1;
    console.log(`[static-data] uploaded manifest ${manifestKey}`);

    // Only publish latest.json after everything else succeeded.
    await doLatest(latestKey, latestBytes);
    uploadedCount += 1;
    latestPublished = true;
    console.log(`[static-data] published latest.json (atomic pointer switch)`);
  }

  const summary = {
    sourceApiUrl: fetchConfig.apiBaseUrl,
    dataVersion,
    generatedAt,
    pokemonCount: pokemonOutputs.size,
    manifestFileName,
    manifestKey,
    manifestUrl,
    manifestByteSize: manifestBytes.length,
    manifestHash,
    manifestFullHash,
    totalJsonByteSize: totalBytes + manifestBytes.length + latestBytes.length,
    uploadedObjectCount: uploadedCount,
    failedIds: failed,
    latestPublished,
    outputRoot: OUTPUT_ROOT,
  };

  return summary;
}

/**
 * Print the final summary block.
 */
export function printSummary(summary) {
  console.log("");
  console.log("=== PokéVibe static-data build summary ===");
  console.log(`source API URL      : ${summary.sourceApiUrl}`);
  console.log(`data version        : ${summary.dataVersion}`);
  console.log(`generated at        : ${summary.generatedAt}`);
  console.log(`generated Pokémon   : ${summary.pokemonCount}`);
  console.log(`manifest filename   : ${summary.manifestFileName}`);
  console.log(`manifest byte size  : ${summary.manifestByteSize}`);
  console.log(`total JSON byte size: ${summary.totalJsonByteSize}`);
  console.log(`uploaded objects    : ${summary.uploadedObjectCount}`);
  console.log(`failed IDs          : ${summary.failedIds.join(", ") || "(none)"}`);
  console.log(`latest.json published: ${summary.latestPublished}`);
  console.log(`output root         : ${summary.outputRoot}`);
  console.log("===========================================");
}
