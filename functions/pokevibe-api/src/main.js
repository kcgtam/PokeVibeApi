import { Client, Databases, ID, Query } from "node-appwrite";

// This Appwrite function will be executed every time your function is triggered
const config = {
  endpoint: process.env.APPWRITE_ENDPOINT,
  projectId: process.env.APPWRITE_PROJECT_ID,
  apiKey: process.env.APPWRITE_API_KEY,
  databaseId: process.env.APPWRITE_DATABASE_ID,
  collectionId:
    process.env.APPWRITE_COLLECTION_ID ||
    process.env.APPWRITE_TABLE_ID ||
    "pokemon_cache",
  pokeApiBaseUrl: process.env.POKEAPI_BASE_URL || "https://pokeapi.co/api/v2",
  cacheTtlDays: Number(process.env.CACHE_TTL_DAYS || 30),
};

const assetBaseUrl =
  process.env.ASSET_BASE_URL || "https://assets.pokevibetab.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const AVAILABLE_ARTWORK_IDS = [
  1, 3, 4, 5, 6, 7, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25,
  26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 39, 41, 43, 44, 45, 46, 47,
  49, 51, 52, 53, 55, 56, 57, 61, 64, 65, 66, 68, 69, 70, 72, 73, 74, 75,
  76, 78, 79, 81, 82, 84, 87, 89, 90, 91, 93, 94, 95, 97, 100, 101, 102,
  104, 105, 106, 112, 113, 114, 115, 117, 118, 119, 123, 124, 125, 126,
  132, 133, 134, 136, 137, 138, 140, 141, 142, 143, 144, 145, 146, 147,
  149,
];

const MOOD_FILTERS = {
  cute: [1, 7, 25, 27, 29, 35, 36, 37, 39, 52, 77, 79, 113, 133],
  strong: [6, 34, 38, 59, 68, 76, 94, 112, 123, 125, 126, 130, 142, 143, 144, 145, 146, 149],
  fast: [15, 18, 25, 26, 38, 49, 51, 53, 57, 65, 78, 85, 94, 100, 101, 123, 125, 135, 142, 145],
  tanky: [3, 9, 31, 34, 36, 40, 68, 76, 80, 89, 91, 95, 112, 113, 115, 131, 143],
  fire: [4, 5, 6, 37, 38, 58, 59, 77, 78, 126, 136, 146],
  water: [7, 8, 9, 54, 55, 60, 61, 62, 72, 73, 79, 80, 86, 87, 90, 91, 98, 99, 116, 117, 118, 119, 120, 121, 129, 130, 131, 134, 138, 139, 140, 141],
  electric: [25, 26, 81, 82, 100, 101, 125, 135, 145],
  grass: [1, 2, 3, 43, 44, 45, 46, 47, 69, 70, 71, 102, 103, 114],
};

const client = new Client()
  .setEndpoint(config.endpoint)
  .setProject(config.projectId)
  .setKey(config.apiKey);

const databases = new Databases(client);

function json(res, data, status = 200) {
  return res.json(data, status, corsHeaders);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= Date.now();
}

function titleCaseFromSlug(value) {
  if (!value) return "";
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStat(stats, name) {
  return stats.find((item) => item.stat.name === name)?.base_stat ?? null;
}

function getEnglishFlavorText(species) {
  const entry = species.flavor_text_entries?.find(
    (item) => item.language?.name === "en"
  );

  return entry?.flavor_text
    ?.replace(/\f/g, " ")
    ?.replace(/\n/g, " ")
    ?.replace(/\s+/g, " ")
    ?.trim() || "";
}

function getEnglishGenus(species) {
  return (
    species.genera?.find((item) => item.language?.name === "en")?.genus || ""
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "PokeVibeTab/1.0 educational fan-made extension",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.json();
}

async function getCache(key) {
  const result = await databases.listDocuments(
    config.databaseId,
    config.collectionId,
    [Query.equal("key", key), Query.limit(1)]
  );

  const document = result.documents?.[0];
  if (!document) return null;

  if (isExpired(document.expiresAt)) {
    return null;
  }

  return JSON.parse(document.value);
}

async function setCache(key, value) {
  const now = new Date();
  const expiresAt = addDays(now, config.cacheTtlDays).toISOString();

  const payload = {
    key,
    value: JSON.stringify(value),
    expiresAt,
    source: "pokeapi",
    updatedAt: now.toISOString(),
  };

  const existing = await databases.listDocuments(
    config.databaseId,
    config.collectionId,
    [Query.equal("key", key), Query.limit(1)]
  );

  const document = existing.documents?.[0];

  if (document) {
    await databases.updateDocument(
      config.databaseId,
      config.collectionId,
      document.$id,
      payload
    );
  } else {
    await databases.createDocument(
      config.databaseId,
      config.collectionId,
      ID.unique(),
      payload
    );
  }

  return value;
}

async function remember(key, fetcher) {
  const cached = await getCache(key);
  if (cached) {
    return { data: cached, cached: true };
  }

  const fresh = await fetcher();
  await setCache(key, fresh);
  return { data: fresh, cached: false };
}

async function getPokemonTabData(nameOrId) {
  const key = `pokemon:${String(nameOrId).toLowerCase()}:tab-data`;

  return remember(key, async () => {
    const pokemon = await fetchJson(
      `${config.pokeApiBaseUrl}/pokemon/${nameOrId}`
    );

    const species = await fetchJson(
      `${config.pokeApiBaseUrl}/pokemon-species/${pokemon.id}`
    );

    const encounters = await fetchJson(
      `${config.pokeApiBaseUrl}/pokemon/${pokemon.id}/encounters`
    );

    const locations = encounters
      .map((item) => item.location_area?.name)
      .filter(Boolean)
      .slice(0, 6)
      .map(titleCaseFromSlug);

    return {
      id: pokemon.id,
      name: pokemon.name,
      displayName: titleCaseFromSlug(pokemon.name),
      types: pokemon.types.map((item) => item.type.name),
      ability: pokemon.abilities?.[0]?.ability?.name || null,
      stats: {
        hp: getStat(pokemon.stats, "hp"),
        attack: getStat(pokemon.stats, "attack"),
        defense: getStat(pokemon.stats, "defense"),
        speed: getStat(pokemon.stats, "speed"),
      },
      artwork: `${assetBaseUrl}/pokemon/official-artwork/${pokemon.id}.webp`,
      species: {
        genus: getEnglishGenus(species),
        flavorText: getEnglishFlavorText(species),
        habitat: species.habitat?.name
          ? titleCaseFromSlug(species.habitat.name)
          : null,
        generation: species.generation?.name
          ? titleCaseFromSlug(species.generation.name)
          : null,
        captureRate: species.capture_rate ?? null,
        baseHappiness: species.base_happiness ?? null,
        color: species.color?.name ? titleCaseFromSlug(species.color.name) : null,
        shape: species.shape?.name ? titleCaseFromSlug(species.shape.name) : null,
      },
      encounters: locations,
    };
  });
}

async function getGen1List() {
  return remember("pokemon:list:gen1", async () => {
    const list = await fetchJson(`${config.pokeApiBaseUrl}/pokemon?limit=151&offset=0`);
    return list.results.map((item) => item.name);
  });
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export default async ({ req, res, log, error }) => {
  const method = req.method || "GET";
  const path = req.path || "/";

  if (method === "OPTIONS") {
    return res.empty(204, corsHeaders);
  }

  log(
    JSON.stringify({
      message: "Function started",
      path: req.path,
      method: req.method,
      endpoint: config.endpoint,
      projectId: config.projectId,
      databaseId: config.databaseId,
      collectionId: config.collectionId,
      hasApiKey: Boolean(config.apiKey),
    })
  );

  try {
    const method = req.method || "GET";
    const path = req.path || "/";

    if (method !== "GET") {
      return json(res, { error: "Method not allowed" }, 405);
    }

    if (path === "/" || path === "/health") {
      return json(res, {
        ok: true,
        service: "pokevibe-api",
        time: new Date().toISOString(),
      });
    }

    const tabDataMatch = path.match(/^\/pokemon\/([^/]+)\/tab-data$/);
    if (tabDataMatch) {
      const nameOrId = decodeURIComponent(tabDataMatch[1]);
      const result = await getPokemonTabData(nameOrId);

      return json(res, {
        ...result.data,
        cached: result.cached,
      });
    }

  if (path === "/random") {
    let mood = req.query?.mood;
    if (!mood && req.queryString) {
      const params = new URLSearchParams(req.queryString);
      mood = params.get("mood");
    }

    let candidateIds = AVAILABLE_ARTWORK_IDS;
    let selectedMood = null;

    if (mood && MOOD_FILTERS[mood]) {
      const moodIds = MOOD_FILTERS[mood];
      const intersected = moodIds.filter((id) => AVAILABLE_ARTWORK_IDS.includes(id));
      if (intersected.length > 0) {
        candidateIds = intersected;
        selectedMood = mood;
      }
    }

    const randomId = pickRandom(candidateIds);
    const result = await getPokemonTabData(randomId);

    const responseData = {
      ...result.data,
      cached: result.cached,
    };

    if (process.env.NODE_ENV === "development") {
      responseData.selectedMood = selectedMood;
      responseData.candidateCount = candidateIds.length;
    }

    log(
      JSON.stringify({
        message: "Random Pokemon selected",
        selectedMood,
        candidateCount: candidateIds.length,
        randomId,
      })
    );

    return json(res, responseData);
  }

    return json(
      res,
      {
        error: "Not found",
        path,
        supportedRoutes: [
          "GET /health",
          "GET /random",
          "GET /pokemon/{name-or-id}/tab-data",
        ],
      },
      404
    );
  } catch (err) {
    error(err.message);

    error(
      JSON.stringify({
        message: err.message,
        stack: err.stack,
        endpoint: config.endpoint,
        projectId: config.projectId,
        databaseId: config.databaseId,
        collectionId: config.collectionId,
        hasApiKey: Boolean(config.apiKey),
      })
    );

    return json(
      res,
      {
        error: "Internal server error",
        message: err.message,
      },
      500
    );
  }
};
