import crypto from "node:crypto";

/**
 * Deterministic JSON serialization.
 *
 * - Object keys are sorted recursively in a stable order (localeCompare).
 * - Arrays preserve order.
 * - Uses 2-space indentation, no trailing spaces, UTF-8.
 * - For deterministic output, we re-parse then re-serialize via a stable
 *   serializer so two builds from identical source data produce identical
 *   bytes (modulo any non-determinism inside the source itself).
 *
 * Note: This intentionally does NOT inject timestamps or random values.
 * The caller controls all timestamp injection (manifest/latest only).
 */
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Convert a value to deterministic UTF-8 bytes.
 */
export function toBytes(value) {
  return Buffer.from(stableStringify(value), "utf8");
}

/**
 * Full SHA-256 hash of the exact bytes, returned as hex.
 *
 * When serializing from a value, this hashes the deterministic JSON output.
 * When given a Buffer, it hashes those exact bytes (used for the upload-time
 * content hash so it reflects what was actually uploaded).
 */
export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : toBytes(input);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Short content hash suitable for immutable filenames.
 * First 16 hex characters of SHA-256 (within the 12-16 range requested).
 */
export function shortHash(input) {
  return sha256Hex(input).slice(0, 16);
}
