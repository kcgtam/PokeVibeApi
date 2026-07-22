#!/usr/bin/env node
/**
 * Publish build: fetch, validate, generate, upload immutable files, then
 * publish latest.json last. Fails the build (and skips latest.json) if any
 * of the 151 Pokémon cannot be generated or validated.
 */
import { buildStaticData, printSummary } from "./build.js";

const summary = await buildStaticData({ publish: true });
printSummary(summary);

if (summary.failedIds.length > 0 || !summary.latestPublished) {
  process.exit(1);
}
