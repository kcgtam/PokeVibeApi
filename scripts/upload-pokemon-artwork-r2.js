import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || "pokevibe-assets";

const FAILED_FILE =
  process.env.FAILED_FILE ||
  path.resolve(__dirname, "../failed-artwork-ids.json");

const DELAY_MS = Number(process.env.DELAY_MS || 15000);

const endpoint =
  R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

if (!endpoint || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  throw new Error(
    "Missing R2 env. Required: R2_ENDPOINT or R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
  );
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readFailedIds() {
  const raw = await fs.readFile(FAILED_FILE, "utf8");
  const ids = JSON.parse(raw);

  if (!Array.isArray(ids)) {
    throw new Error(`${FAILED_FILE} must contain a JSON array`);
  }

  return [...new Set(ids.map(Number))]
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 151)
    .sort((a, b) => a - b);
}

async function writeFailedIds(ids) {
  const uniqueSorted = [...new Set(ids.map(Number))]
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 151)
    .sort((a, b) => a - b);

  await fs.writeFile(
    FAILED_FILE,
    JSON.stringify(uniqueSorted, null, 2) + "\n",
    "utf8"
  );
}

async function exists(key) {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}

async function downloadPng(id) {
  const sourceUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

  console.log(`Downloading ${id}...`);

  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "PokeVibeTab asset preparation script",
      Accept: "image/png,image/*,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${id}: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function uploadPokemon(id) {
  const key = `pokemon/official-artwork/${id}.webp`;

  if (await exists(key)) {
    console.log(`Skip ${id}: already exists on R2`);
    return { status: "skipped" };
  }

  const pngBuffer = await downloadPng(id);

  const webpBuffer = await sharp(pngBuffer)
    .resize({
      width: 900,
      height: 900,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({
      quality: 85,
      effort: 4,
    })
    .toBuffer();

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: webpBuffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  console.log(`Uploaded ${key}`);
  return { status: "uploaded" };
}

async function main() {
  let failedIds = await readFailedIds();

  console.log(`Retrying ${failedIds.length} failed IDs from: ${FAILED_FILE}`);
  console.log(`Delay between IDs: ${DELAY_MS / 1000}s`);

  let uploadedCount = 0;
  let skippedCount = 0;
  const stillFailed = [];

  for (const id of failedIds) {
    try {
      const result = await uploadPokemon(id);

      if (result.status === "uploaded") uploadedCount += 1;
      if (result.status === "skipped") skippedCount += 1;

      // Remove immediately after success/skip so progress is saved
      failedIds = failedIds.filter((item) => item !== id);
      await writeFailedIds(failedIds);
    } catch (error) {
      console.error(`Failed ${id}: ${error.message}`);
      stillFailed.push(id);
    }

    await sleep(DELAY_MS);
  }

  // Merge any IDs that still failed back into the file.
  await writeFailedIds(stillFailed);

  console.log("\nDone.");
  console.log(`Uploaded: ${uploadedCount}`);
  console.log(`Skipped existing: ${skippedCount}`);
  console.log(`Still failed: ${stillFailed.length}`);

  if (stillFailed.length > 0) {
    console.log(`Still failed IDs: ${stillFailed.join(", ")}`);
    console.log("\nRun this script again later. Existing R2 files will be skipped.");
  } else {
    console.log("All failed artwork IDs are now uploaded.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});