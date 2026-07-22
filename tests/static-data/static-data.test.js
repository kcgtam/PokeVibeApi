import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  validateTabData,
  validateManifest,
  validateLatest,
  ValidationError,
} from "../../scripts/static-data/lib/validate.js";
import { stableStringify, toBytes, sha256Hex, shortHash } from "../../scripts/static-data/lib/hash.js";
import { buildStaticData, POKEMON_COUNT } from "../../scripts/static-data/build.js";

// ---------- Fixtures ----------

const POKEMON_NAMES = [
  "bulbasaur","ivysaur","venusaur","charmander","charmeleon","charizard",
  "squirtle","wartortle","blastoise","caterpie","metapod","butterfree",
  "weedle","kakuna","beedrill","pidgey","pidgeotto","pidgeot","rattata",
  "raticate","spearow","fearow","ekans","arbok","pikachu","raichu",
  "sandshrew","sandslash","nidoran-f","nidorina","nidoqueen","nidoran-m",
  "nidorino","nidoking","clefairy","clefable","vulpix","ninetales",
  "jigglypuff","wigglytuff","zubat","golbat","oddish","gloom","vileplume",
  "paras","parasect","venonat","venomoth","diglett","dugtrio","meowth",
  "persian","psyduck","golduck","mankey","primeape","growlithe","arcanine",
  "poliwag","poliwhirl","poliwrath","abra","kadabra","alakazam","machop",
  "machoke","machamp","bellsprout","weepinbell","victreebel","tentacool",
  "tentacruel","geodude","graveler","golem","ponyta","rapidash","slowpoke",
  "slowbro","magnemite","magneton","farfetchd","doduo","dodrio","seel",
  "dewgong","grimer","muk","shellder","cloyster","gastly","haunter",
  "gengar","onix","drowzee","hypno","krabby","kingler","voltorb",
  "electrode","exeggcute","exeggutor","cubone","marowak","hitmonlee",
  "hitmonchan","lickitung","koffing","weezing","rhyhorn","rhydon","chansey",
  "tangela","kangaskhan","horsea","seadra","goldeen","seaking","staryu",
  "starmie","mr-mime","scyther","jynx","electabuzz","magmar","pinsir",
  "tauros","magikarp","gyarados","lapras","ditto","eevee","vaporeon",
  "jolteon","flareon","porygon","omanyte","omastar","kabuto","kabutops",
  "aerodactyl","snorlax","articuno","zapdos","moltres","dratini",
  "dragonair","dragonite","mewtwo","mew",
];

const ASSET = "https://assets.pokevibetab.app/";

function buildEvoChain(ids) {
  return ids.map((id) => ({
    id,
    name: POKEMON_NAMES[id - 1] || `pokemon-${id}`,
    displayName: (POKEMON_NAMES[id - 1] || `pokemon-${id}`)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    artwork: `${ASSET}pokemon/official-artwork/${id}.webp`,
  }));
}

const EVO_CHAINS = {
  1: [1, 2, 3],
  4: [4, 5, 6],
  7: [7, 8, 9],
  25: [25, 26],
  133: [133, 134, 135, 136],
};

function makeTabData(id) {
  const name = POKEMON_NAMES[id - 1] || `pokemon-${id}`;
  const displayName = name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const types = ["normal"];
  if (id <= 3) types[0] = "grass";
  if (id === 25) types[0] = "electric";
  if (id === 133) types[0] = "normal";

  return {
    id,
    name,
    displayName,
    types,
    ability: "static",
    stats: {
      hp: 35 + (id % 20),
      attack: 55 + (id % 15),
      defense: 40 + (id % 10),
      speed: 90 - (id % 10),
    },
    artwork: `${ASSET}pokemon/official-artwork/${id}.webp`,
    species: {
      genus: "Test Pokémon",
      flavorText: "A test fixture.",
      habitat: "Forest",
      generation: "Generation I",
      captureRate: 45,
      baseHappiness: 70,
      color: "Yellow",
      shape: "Upright",
    },
    encounters: ["Pallet Town Area", "Viridian Forest Area"],
    encounterDetails: [
      {
        locationAreaName: "pallet-town-area",
        displayName: "Pallet Town Area",
        region: "Kanto",
        methods: ["Walk"],
        versions: ["Red", "Blue"],
        minLevel: 3,
        maxLevel: 5,
        chance: 5,
        maxChance: 10,
        conditions: [],
      },
    ],
    evolutionChain: buildEvoChain(EVO_CHAINS[id] || [id]),
    cached: true,
  };
}

// A mock fetch that returns valid tab-data for any id 1..151.
function mockFetch() {
  const calls = [];
  return async (url, opts) => {
    calls.push(url);
    const match = url.match(/\/pokemon\/(\d+)\/tab-data$/);
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    const id = Number(match[1]);
    if (id < 1 || id > 151) {
      return new Response("not found", { status: 404 });
    }
    const data = makeTabData(id);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

// A mock fetch that fails for one specific id (returns 500 always).
function mockFetchFailingAt(failId) {
  return async (url) => {
    const match = url.match(/\/pokemon\/(\d+)\/tab-data$/);
    const id = Number(match[1]);
    if (id === failId) {
      return new Response("boom", { status: 500 });
    }
    const data = makeTabData(id);
    return new Response(JSON.stringify(data), { status: 200 });
  };
}

function mockUploader() {
  const immutable = [];
  const latest = [];
  return {
    immutable,
    latest,
    uploadImmutable: async (key, bytes) => {
      immutable.push({ key, bytes });
      return `https://assets.pokevibetab.app/${key}`;
    },
    uploadLatest: async (key, bytes) => {
      latest.push({ key, bytes });
      return `https://assets.pokevibetab.app/${key}`;
    },
  };
}

// Use a temp output root so tests don't clobber a real build.
async function withTempOutputRoot(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pokevibe-test-"));
  const prev = process.env.STATIC_DATA_OUTPUT_ROOT;
  process.env.STATIC_DATA_OUTPUT_ROOT = tmp;
  // Also override OUTPUT_ROOT by re-importing? No — OUTPUT_ROOT is resolved at
  // module load. Instead we read from the summary.outputRoot which reflects env.
  try {
    return await fn();
  } finally {
    process.env.STATIC_DATA_OUTPUT_ROOT = prev;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function fetchConfigForTest(fetchImpl) {
  return {
    apiBaseUrl: "https://test.local",
    concurrency: 4,
    timeoutMs: 5000,
    maxRetries: 1,
    baseBackoffMs: 1,
    maxBackoffMs: 2,
    userAgent: "test",
    fetch: fetchImpl,
  };
}

// ---------- Tests ----------

test("validateTabData accepts a well-formed fixture", () => {
  const data = makeTabData(25);
  validateTabData(data, 25);
  assert.equal(data.name, "pikachu");
  assert.equal(data.displayName, "Pikachu");
});

test("validateTabData rejects mismatched id", () => {
  const data = makeTabData(25);
  assert.throws(
    () => validateTabData(data, 26),
    (e) => e instanceof ValidationError && /does not match/.test(e.message)
  );
});

test("validateTabData rejects id out of range", () => {
  const data = makeTabData(25);
  data.id = 200;
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects empty name", () => {
  const data = makeTabData(25);
  data.name = "";
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects empty types", () => {
  const data = makeTabData(25);
  data.types = [];
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects non-numeric stats", () => {
  const data = makeTabData(25);
  data.stats.hp = "35";
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects non-asset artwork", () => {
  const data = makeTabData(25);
  data.artwork = "https://raw.githubusercontent.com/x/25.webp";
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects raw.githubusercontent in evolutionChain", () => {
  const data = makeTabData(25);
  data.evolutionChain[0].artwork =
    "https://raw.githubusercontent.com/sprites/25.webp";
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects NaN values", () => {
  const data = makeTabData(25);
  data.stats.hp = NaN;
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects undefined values", () => {
  const data = makeTabData(25);
  data.species.habitat = undefined;
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("validateTabData rejects non-array encounterDetails", () => {
  const data = makeTabData(25);
  data.encounterDetails = {};
  assert.throws(() => validateTabData(data, 25), ValidationError);
});

test("stableStringify produces sorted-key output deterministically", () => {
  const a = { b: 1, a: 2, c: { z: 1, a: 2 } };
  const b = { a: 2, b: 1, c: { a: 2, z: 1 } };
  assert.equal(stableStringify(a), stableStringify(b));
  // Keys are sorted
  assert.match(stableStringify(a), /\{[\s\S]*"a": 2,[\s\S]*"b": 1,[\s\S]*"c": \{[\s\S]*"a": 2,[\s\S]*"z": 1[\s\S]*\}/);
});

test("shortHash is 16 hex chars and stable for identical input", () => {
  const data = makeTabData(25);
  const h1 = shortHash(toBytes(data));
  const h2 = shortHash(toBytes(data));
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{16}$/);
});

test("sha256Hex of identical input is identical", () => {
  const data = makeTabData(25);
  const f1 = sha256Hex(toBytes(data));
  const f2 = sha256Hex(toBytes(data));
  assert.equal(f1, f2);
  assert.match(f1, /^[0-9a-f]{64}$/);
});

test("full dry-run build generates all 151 files with valid structure", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });

    assert.equal(summary.pokemonCount, 151);
    assert.equal(summary.failedIds.length, 0);
    assert.equal(summary.latestPublished, false);
    assert.equal(summary.uploadedObjectCount, 0);
    assert.match(summary.manifestFileName, /^manifest\.[0-9a-f]{16}\.json$/);

    // Read index.json and verify all 151 ids present exactly once.
    const index = JSON.parse(
      await fs.readFile(path.join(summary.outputRoot, "index.json"), "utf8")
    );
    assert.equal(index.pokemonCount, 151);
    assert.equal(index.pokemon.length, 151);
    const ids = index.pokemon.map((p) => p.id);
    assert.deepEqual(
      ids.slice().sort((a, b) => a - b),
      Array.from({ length: 151 }, (_, i) => i + 1)
    );
    assert.equal(new Set(ids).size, 151);

    // Every pokemon file exists on disk.
    for (const p of index.pokemon) {
      const pPath = path.join(summary.outputRoot, p.key);
      const stat = await fs.stat(pPath);
      assert.ok(stat.size > 0, `${p.key} should be non-empty`);
      const data = JSON.parse(await fs.readFile(pPath, "utf8"));
      // Validate each file is well-formed tab-data.
      validateTabData(data, p.id);
    }

    // Manifest file exists and is valid.
    const manifestPath = path.join(summary.outputRoot, index.manifestKey);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assert.equal(manifest.pokemonCount, 151);
    assert.equal(manifest.pokemon.length, 151);
    // Manifest is sorted by id ascending.
    const mIds = manifest.pokemon.map((p) => p.id);
    assert.deepEqual(mIds, mIds.slice().sort((a, b) => a - b));
    // No duplicate ids or names.
    assert.equal(new Set(mIds).size, 151);
    assert.equal(
      new Set(manifest.pokemon.map((p) => p.name)).size,
      151
    );
    // Manifest entries exclude heavy fields.
    for (const e of manifest.pokemon) {
      assert.ok(!("species" in e), "manifest entry must not include species");
      assert.ok(!("encounters" in e), "manifest entry must not include encounters");
      assert.ok(!("encounterDetails" in e), "manifest entry must not include encounterDetails");
      assert.ok(!("evolutionChain" in e), "manifest entry must not include evolutionChain");
    }
    // All dataUrls resolve to generated files.
    for (const e of manifest.pokemon) {
      assert.match(
        e.dataUrl,
        /^https:\/\/assets\.pokevibetab\.app\/data\/v1\/pokemon\/\d{3}\.[0-9a-f]{16}\.json$/
      );
      const p = index.pokemon.find((x) => x.id === e.id);
      assert.equal(e.dataUrl, p.dataUrl);
    }

    // latest.json exists locally (dry-run still writes it).
    const latestPath = path.join(summary.outputRoot, index.latestKey);
    const latest = JSON.parse(await fs.readFile(latestPath, "utf8"));
    assert.equal(latest.pokemonCount, 151);
    assert.equal(latest.manifestUrl, index.manifestUrl);
    assert.equal(latest.manifestHash, index.manifestFullHash);
    assert.match(latest.manifestHash, /^[0-9a-f]{64}$/);
  });
});

test("Bulbasaur data contains a valid evolutionChain", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const bulbaPath = path.join(
      summary.outputRoot,
      "data/v1/pokemon",
      (await firstFileName(summary.outputRoot, 1))
    );
    const data = JSON.parse(await fs.readFile(bulbaPath, "utf8"));
    assert.ok(Array.isArray(data.evolutionChain));
    assert.ok(data.evolutionChain.length >= 3);
    const names = data.evolutionChain.map((n) => n.name);
    assert.deepEqual(names, ["bulbasaur", "ivysaur", "venusaur"]);
    for (const node of data.evolutionChain) {
      assert.match(
        node.artwork,
        /^https:\/\/assets\.pokevibetab\.app\/pokemon\/official-artwork\/\d+\.webp$/
      );
    }
  });
});

test("Pikachu data contains Pikachu and Raichu where supplied by backend", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const fname = await firstFileName(summary.outputRoot, 25);
    const data = JSON.parse(
      await fs.readFile(path.join(summary.outputRoot, "data/v1/pokemon", fname), "utf8")
    );
    const names = data.evolutionChain.map((n) => n.name);
    assert.ok(names.includes("pikachu"));
    assert.ok(names.includes("raichu"));
  });
});

test("Eevee data contains valid Gen 1 evolution nodes", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const fname = await firstFileName(summary.outputRoot, 133);
    const data = JSON.parse(
      await fs.readFile(path.join(summary.outputRoot, "data/v1/pokemon", fname), "utf8")
    );
    const ids = data.evolutionChain.map((n) => n.id);
    assert.ok(ids.includes(133)); // eevee
    // Eevee's Gen-1 evolutions: vaporeon(134), jolteon(135), flareon(136)
    assert.ok(ids.includes(134));
    assert.ok(ids.includes(135));
    assert.ok(ids.includes(136));
    for (const node of data.evolutionChain) {
      assert.ok(node.id >= 1 && node.id <= 151, "evo id must be Gen 1");
    }
  });
});

test("all artwork URLs use assets.pokevibetab.app across the build", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const index = JSON.parse(
      await fs.readFile(path.join(summary.outputRoot, "index.json"), "utf8")
    );
    for (const p of index.pokemon) {
      const data = JSON.parse(
        await fs.readFile(path.join(summary.outputRoot, p.key), "utf8")
      );
      assert.match(
        data.artwork,
        /^https:\/\/assets\.pokevibetab\.app\//
      );
      for (const node of data.evolutionChain) {
        assert.match(
          node.artwork,
          /^https:\/\/assets\.pokevibetab\.app\//
        );
      }
    }
  });
});

test("all dataUrl values resolve to generated output files", async () => {
  await withTempOutputRoot(async () => {
    const summary = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const manifest = JSON.parse(
      await fs.readFile(path.join(summary.outputRoot, summary.manifestKey), "utf8")
    );
    for (const e of manifest.pokemon) {
      const key = e.dataUrl.replace(/^https:\/\/assets\.pokevibetab\.app\//, "");
      const p = path.join(summary.outputRoot, key);
      const stat = await fs.stat(p);
      assert.ok(stat.size > 0);
    }
  });
});

test("same input produces the same content hashes", async () => {
  // The generated dataUrl hashes must be identical across two builds given
  // identical source data (mock fetch is deterministic).
  let firstHashes = null;
  await withTempOutputRoot(async () => {
    const first = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const firstIndex = JSON.parse(
      await fs.readFile(path.join(first.outputRoot, "index.json"), "utf8")
    );
    firstHashes = firstIndex.pokemon.map((p) => ({ id: p.id, hash: p.hash }));
  });

  let secondHashes = null;
  await withTempOutputRoot(async () => {
    const second = await buildStaticData({
      publish: false,
      fetchConfig: fetchConfigForTest(mockFetch()),
    });
    const secondIndex = JSON.parse(
      await fs.readFile(path.join(second.outputRoot, "index.json"), "utf8")
    );
    secondHashes = secondIndex.pokemon.map((p) => ({ id: p.id, hash: p.hash }));
  });

  assert.equal(firstHashes.length, 151);
  assert.equal(secondHashes.length, 151);
  for (let i = 0; i < firstHashes.length; i++) {
    assert.equal(
      firstHashes[i].id,
      secondHashes[i].id,
      "id order must match"
    );
    assert.equal(
      firstHashes[i].hash,
      secondHashes[i].hash,
      `hash mismatch for id ${firstHashes[i].id}`
    );
  }
});

test("latest.json is not uploaded when one Pokémon generation fails", async () => {
  await withTempOutputRoot(async () => {
    const uploader = mockUploader();
    await assert.rejects(
      buildStaticData({
        publish: true,
        fetchConfig: fetchConfigForTest(mockFetchFailingAt(50)),
        uploader,
      }),
      (err) => /worker failed/.test(err.message) || /HTTP 500/.test(err.message)
    );
    // No uploads should have happened, and definitely no latest.json.
    assert.equal(uploader.immutable.length, 0, "no immutable files should upload on failure");
    assert.equal(uploader.latest.length, 0, "latest.json must not be uploaded on failure");
  });
});

test("publish with mock uploader uploads 151 pokemon + manifest + latest in order", async () => {
  await withTempOutputRoot(async () => {
    const uploader = mockUploader();
    const summary = await buildStaticData({
      publish: true,
      fetchConfig: fetchConfigForTest(mockFetch()),
      uploader,
    });
    assert.equal(uploader.immutable.length, 152); // 151 + manifest
    assert.equal(uploader.latest.length, 1);
    assert.equal(summary.uploadedObjectCount, 153);
    assert.equal(summary.latestPublished, true);
    // First 151 immutable uploads are pokemon files.
    const pokemonKeys = uploader.immutable.slice(0, 151).map((x) => x.key);
    for (const k of pokemonKeys) {
      assert.match(k, /^data\/v1\/pokemon\/\d{3}\.[0-9a-f]{16}\.json$/);
    }
    // The 152nd immutable upload is the manifest.
    const manifestKey = uploader.immutable[151].key;
    assert.match(manifestKey, /^data\/v1\/manifest\.[0-9a-f]{16}\.json$/);
    // latest.json is the only "latest" upload and comes after everything.
    assert.equal(uploader.latest[0].key, "data/v1/latest.json");
  });
});

// ---------- Helpers ----------

async function firstFileName(outputRoot, id) {
  const dir = path.join(outputRoot, "data/v1/pokemon");
  const files = await fs.readdir(dir);
  const padded = String(id).padStart(3, "0");
  const match = files.find((f) => f.startsWith(`${padded}.`));
  if (!match) throw new Error(`no file for id ${id}`);
  return match;
}
