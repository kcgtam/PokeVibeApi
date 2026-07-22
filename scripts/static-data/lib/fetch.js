/**
 * Fetch normalized tab-data for Pokémon IDs 1..151 from the PokéVibe backend.
 *
 * Default source: https://api.pokevibetab.app (configurable via POKEVIBE_API_BASE_URL).
 * The publisher must NOT call PokeAPI directly when the normalized endpoint is
 * available — that logic lives in the Appwrite function, not here.
 *
 * Features:
 * - Bounded concurrency (default 3)
 * - Retry transient 429 and 5xx responses
 * - Exponential backoff with full jitter
 * - Per-request timeout (default 30s)
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function defaultConfig() {
  return {
    apiBaseUrl:
      process.env.POKEVIBE_API_BASE_URL || "https://api.pokevibetab.app",
    concurrency: Number(process.env.POKEMON_FETCH_CONCURRENCY || 3),
    timeoutMs: Number(process.env.POKEMON_FETCH_TIMEOUT_MS || 30000),
    maxRetries: Number(process.env.POKEMON_FETCH_MAX_RETRIES || 5),
    baseBackoffMs: Number(process.env.POKEMON_FETCH_BASE_BACKOFF_MS || 500),
    maxBackoffMs: Number(process.env.POKEMON_FETCH_MAX_BACKOFF_MS || 16000),
    userAgent: "PokeVibeStaticDataBuilder/1.0",
    // Optional override of the global fetch (used by tests). When unset, the
    // global fetch is used.
    fetch: undefined,
  };
}

/**
 * Fetch one tab-data response with retries.
 *
 * Retries on 429 and 5xx. Throws on 4xx (non-429), non-JSON, or network errors
 * after exhausting retries.
 */
export async function fetchTabData(id, cfg) {
  const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}/pokemon/${id}/tab-data`;
  let lastError = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const fetchImpl = cfg.fetch || globalThis.fetch;
      const response = await fetchImpl(url, {
        headers: {
          "User-Agent": cfg.userAgent,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      const text = await response.text();

      if (response.ok) {
        try {
          return JSON.parse(text);
        } catch (err) {
          throw new Error(`invalid JSON for id ${id}: ${err.message}`);
        }
      }

      // Retryable: 429 and 5xx.
      if (
        response.status !== 429 &&
        !(response.status >= 500 && response.status <= 599)
      ) {
        // Non-retryable client error.
        throw new Error(`HTTP ${response.status} for id ${id}: ${text.slice(0, 200)}`);
      }

      lastError = new Error(
        `HTTP ${response.status} for id ${id} (attempt ${attempt + 1}): ${text.slice(0, 200)}`
      );

      if (attempt === cfg.maxRetries) break;

      const backoff = backoffMs(attempt, cfg);
      await sleep(backoff);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        lastError = new Error(`timeout for id ${id} after ${cfg.timeoutMs}ms`);
      } else if (
        err.message &&
        err.message.startsWith("HTTP ")
      ) {
        // Non-retryable client error, already decided above.
        throw err;
      } else {
        lastError = err;
      }

      // For network errors, retry until exhausted.
      if (attempt === cfg.maxRetries) break;
      const backoff = backoffMs(attempt, cfg);
      await sleep(backoff);
      continue;
    }
    clearTimeout(timer);
  }

  throw lastError || new Error(`fetch failed for id ${id}`);
}

/**
 * Exponential backoff with full jitter.
 *
 * base = baseBackoffMs * 2^attempt (capped at maxBackoffMs)
 * delay = random(0, base)
 */
function backoffMs(attempt, cfg) {
  const exp = Math.min(
    cfg.baseBackoffMs * 2 ** attempt,
    cfg.maxBackoffMs
  );
  return Math.floor(Math.random() * exp);
}

/**
 * Run an async mapper over a list with a bounded concurrency limit.
 *
 * Preserves input order in the results array. Failures are collected: this
 * helper throws on the first failure by default (fail-fast). Callers that
 * want all results can catch and inspect.
 */
export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  let failed = false;
  let firstError = null;

  async function worker() {
    while (true) {
      if (failed) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = { index, item: items[index], error: err };
        }
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, worker);
  await Promise.all(workers);
  if (failed) {
    const e = new Error(
      `worker failed on ${firstError.item}: ${firstError.error.message}`
    );
    e.cause = firstError;
    throw e;
  }
  return results;
}
