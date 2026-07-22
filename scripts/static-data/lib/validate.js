/**
 * Validation for normalized PokéVibe tab-data responses.
 *
 * These validators are intentionally pure (no I/O) so they can be unit-tested
 * in isolation and reused by both the build pipeline and the test suite.
 */

const ASSET_BASE_URL = "https://assets.pokevibetab.app/";
const FORBIDDEN_HOST = "raw.githubusercontent.com";

export class ValidationError extends Error {
  constructor(message, context) {
    super(message);
    this.name = "ValidationError";
    this.context = context;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function checkSerializable(value, path, seen) {
  // Detect undefined, NaN, functions, symbols, circular refs, BigInt.
  if (value === undefined) {
    throw new ValidationError(`undefined value at ${path}`);
  }
  if (typeof value === "number" && Number.isNaN(value)) {
    throw new ValidationError(`NaN value at ${path}`);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new ValidationError(`non-serializable ${typeof value} at ${path}`);
  }
  if (typeof value === "bigint") {
    throw new ValidationError(`BigInt value at ${path}`);
  }
  if (value === null) return; // null is serializable
  if (typeof value !== "object") return;

  if (seen.has(value)) {
    throw new ValidationError(`circular reference at ${path}`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      checkSerializable(value[i], `${path}[${i}]`, seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      checkSerializable(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

/**
 * Recursively verify the object contains only JSON-serializable values
 * (no undefined, NaN, functions, symbols, BigInt, circular references).
 */
export function assertSerializable(value, path = "$") {
  checkSerializable(value, path, new WeakSet());
}

/**
 * Validate a normalized tab-data response for a given requested ID.
 *
 * Throws ValidationError on any violation.
 */
export function validateTabData(data, requestedId) {
  const ctx = `pokemon#${requestedId}`;

  if (!data || typeof data !== "object") {
    throw new ValidationError("response is not an object", ctx);
  }

  // id must match the requested ID and be in 1..151.
  if (!Number.isInteger(data.id) || data.id !== requestedId) {
    throw new ValidationError(
      `id ${data.id} does not match requested ${requestedId}`,
      ctx
    );
  }
  if (data.id < 1 || data.id > 151) {
    throw new ValidationError(`id ${data.id} out of range 1..151`, ctx);
  }

  if (!isNonEmptyString(data.name)) {
    throw new ValidationError("name is not a non-empty string", ctx);
  }
  if (!isNonEmptyString(data.displayName)) {
    throw new ValidationError("displayName is not a non-empty string", ctx);
  }

  if (!Array.isArray(data.types) || data.types.length === 0) {
    throw new ValidationError("types must be a non-empty array", ctx);
  }
  for (const t of data.types) {
    if (!isNonEmptyString(t)) {
      throw new ValidationError("types contains a non-string entry", ctx);
    }
  }

  if (!data.stats || typeof data.stats !== "object") {
    throw new ValidationError("stats is missing or not an object", ctx);
  }
  for (const key of ["hp", "attack", "defense", "speed"]) {
    if (!isFiniteNumber(data.stats[key])) {
      throw new ValidationError(`stats.${key} is not a finite number`, ctx);
    }
  }

  if (!isNonEmptyString(data.artwork)) {
    throw new ValidationError("artwork is not a non-empty string", ctx);
  }
  if (!data.artwork.startsWith(ASSET_BASE_URL)) {
    throw new ValidationError(
      `artwork must start with ${ASSET_BASE_URL}`,
      ctx
    );
  }
  if (data.artwork.includes(FORBIDDEN_HOST)) {
    throw new ValidationError("artwork must not use raw.githubusercontent.com", ctx);
  }

  // species is required (an object), but its internal shape is backend-defined.
  if (!data.species || typeof data.species !== "object") {
    throw new ValidationError("species is missing or not an object", ctx);
  }

  if (!Array.isArray(data.encounters)) {
    throw new ValidationError("encounters must be an array", ctx);
  }

  if (!Array.isArray(data.encounterDetails)) {
    throw new ValidationError("encounterDetails must be an array", ctx);
  }

  if (!Array.isArray(data.evolutionChain)) {
    throw new ValidationError("evolutionChain must be an array", ctx);
  }

  for (const node of data.evolutionChain) {
    if (!node || typeof node !== "object") {
      throw new ValidationError("evolutionChain contains a non-object node", ctx);
    }
    if (!isNonEmptyString(node.artwork)) {
      throw new ValidationError("evolutionChain node missing artwork", ctx);
    }
    if (!node.artwork.startsWith(ASSET_BASE_URL)) {
      throw new ValidationError(
        "evolutionChain artwork must use assets.pokevibetab.app",
        ctx
      );
    }
    if (node.artwork.includes(FORBIDDEN_HOST)) {
      throw new ValidationError(
        "evolutionChain artwork must not use raw.githubusercontent.com",
        ctx
      );
    }
  }

  // Finally, ensure the whole thing is serializable.
  assertSerializable(data, ctx);
}

/**
 * Validate the constructed core manifest.
 */
export function validateManifest(manifest, pokemonById) {
  if (!manifest || typeof manifest !== "object") {
    throw new ValidationError("manifest is not an object", "manifest");
  }
  if (manifest.schemaVersion !== 1) {
    throw new ValidationError("manifest.schemaVersion must be 1", "manifest");
  }
  if (manifest.pokemonCount !== 151) {
    throw new ValidationError("manifest.pokemonCount must be 151", "manifest");
  }
  if (!Array.isArray(manifest.pokemon) || manifest.pokemon.length !== 151) {
    throw new ValidationError("manifest.pokemon must have 151 entries", "manifest");
  }

  const ids = new Set();
  const names = new Set();
  let prevId = 0;
  for (const entry of manifest.pokemon) {
    if (!Number.isInteger(entry.id) || entry.id < 1 || entry.id > 151) {
      throw new ValidationError("manifest entry has invalid id", "manifest");
    }
    if (ids.has(entry.id)) {
      throw new ValidationError(`duplicate manifest id ${entry.id}`, "manifest");
    }
    ids.add(entry.id);
    if (entry.id <= prevId) {
      throw new ValidationError("manifest entries must be sorted by id ascending", "manifest");
    }
    prevId = entry.id;

    if (!isNonEmptyString(entry.name)) {
      throw new ValidationError("manifest entry has invalid name", "manifest");
    }
    if (names.has(entry.name)) {
      throw new ValidationError(`duplicate manifest name ${entry.name}`, "manifest");
    }
    names.add(entry.name);

    // dataUrl must point at the generated immutable Pokémon JSON.
    const expected = pokemonById.get(entry.id);
    if (!expected) {
      throw new ValidationError(`manifest entry ${entry.id} has no matching output`, "manifest");
    }
    if (entry.dataUrl !== expected.dataUrl) {
      throw new ValidationError(
        `manifest dataUrl mismatch for id ${entry.id}: ${entry.dataUrl} vs ${expected.dataUrl}`,
        "manifest"
      );
    }
  }
}

/**
 * Validate the latest.json pointer.
 */
export function validateLatest(latest, manifestUrl, manifestFullHash) {
  if (!latest || typeof latest !== "object") {
    throw new ValidationError("latest is not an object", "latest");
  }
  if (latest.schemaVersion !== 1) {
    throw new ValidationError("latest.schemaVersion must be 1", "latest");
  }
  if (latest.pokemonCount !== 151) {
    throw new ValidationError("latest.pokemonCount must be 151", "latest");
  }
  if (latest.manifestUrl !== manifestUrl) {
    throw new ValidationError("latest.manifestUrl mismatch", "latest");
  }
  if (latest.manifestHash !== manifestFullHash) {
    throw new ValidationError("latest.manifestHash mismatch", "latest");
  }
}
