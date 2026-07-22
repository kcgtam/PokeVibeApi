#!/usr/bin/env node
/**
 * Dry-run build: fetch, validate, generate local output, print summary.
 * Does NOT upload to R2.
 */
import { buildStaticData, printSummary } from "./build.js";

const summary = await buildStaticData({ publish: false });
printSummary(summary);

if (summary.failedIds.length > 0) {
  process.exit(1);
}
