import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Reuse the existing AWS S3-compatible R2 configuration used by
 * scripts/upload-pokemon-artwork-r2.js so the same env vars drive both.
 *
 * Env:
 *  R2_ENDPOINT or R2_ACCOUNT_ID  -> endpoint
 *  R2_ACCESS_KEY_ID              -> access key
 *  R2_SECRET_ACCESS_KEY          -> secret key
 *  R2_BUCKET                     -> bucket (default: pokevibe-assets)
 *  ASSET_BASE_URL               -> public base URL (default: https://assets.pokevibetab.app)
 */

export function r2ConfigFromEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

  const bucket = process.env.R2_BUCKET || "pokevibe-assets";
  const assetBaseUrl =
    process.env.ASSET_BASE_URL || "https://assets.pokevibetab.app";

  return {
    endpoint,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket,
    assetBaseUrl,
  };
}

export function hasR2Credentials(cfg = r2ConfigFromEnv()) {
  return Boolean(
    cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey
  );
}

export function createR2Client(cfg) {
  return new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const LATEST_CACHE = "public, max-age=300, must-revalidate";
const CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * Upload an immutable content-hashed JSON object.
 *
 * Used for Pokémon JSON files and the manifest. Returns the public URL.
 */
export async function uploadImmutable(client, cfg, key, body) {
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: CONTENT_TYPE,
      CacheControl: IMMUTABLE_CACHE,
    })
  );
  return publicUrl(cfg, key);
}

/**
 * Upload the latest.json pointer.
 *
 * Only call this after all immutable files are confirmed uploaded.
 */
export async function uploadLatest(client, cfg, key, body) {
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: CONTENT_TYPE,
      CacheControl: LATEST_CACHE,
    })
  );
  return publicUrl(cfg, key);
}

export function publicUrl(cfg, key) {
  return `${cfg.assetBaseUrl.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}
