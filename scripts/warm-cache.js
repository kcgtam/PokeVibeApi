const API_BASE_URL = "https://api.pokevibetab.app";

const AVAILABLE_ARTWORK_IDS = Array.from(
  { length: 151 },
  (_, index) => index + 1
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function warm(id) {
  const started = Date.now();
  const response = await fetch(`${API_BASE_URL}/pokemon/${id}/tab-data`, {
    headers: {
      "User-Agent": "PokeVibeCacheWarm/1.0",
    },
  });

  const text = await response.text();
  const elapsed = Date.now() - started;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = JSON.parse(text);

  console.log(
    `#${id} ${data.name} cached=${data.cached} time=${elapsed}ms`
  );

  return data;
}

async function main() {
  let success = 0;
  const failed = [];

  for (const id of AVAILABLE_ARTWORK_IDS) {
    try {
      await warm(id);
      success += 1;
    } catch (error) {
      console.error(`#${id} failed: ${error.message}`);
      failed.push(id);
    }

    await sleep(1000);
  }

  console.log("\nDone");
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log(`Failed IDs: ${failed.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});