const API_BASE_URL = "https://api.pokevibetab.app";

const AVAILABLE_ARTWORK_IDS = [
  1, 3, 4, 5, 6, 7, 13, 14, 15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27,
  28, 29, 31, 32, 34, 36, 37, 38, 41, 43, 44, 47, 49, 52, 53, 55, 57, 61,
  66, 68, 69, 70, 72, 73, 74, 75, 76, 78, 79, 81, 82, 84, 87, 89, 90, 91,
  93, 94, 95, 97, 101, 102, 104, 105, 112, 113, 114, 115, 117, 118, 119,
  123, 125, 132, 133, 134, 136, 137, 138, 140, 141, 142, 143, 144, 145,
  146, 147, 149,
];

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