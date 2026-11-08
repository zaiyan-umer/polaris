// ============================================================================
// HTTP helpers with retry
// ============================================================================
//
// Several of the public endpoints used here (AWS S3 in particular) intermittently
// drop a connection. A transient failure would otherwise abort a whole ingestion
// run, so every outbound request goes through `fetchWithRetry`.

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 600;

/** Error raised when a request keeps failing after all attempts. */
class HttpError extends Error {
  constructor(message, { status = null, attempts = 0 } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.attempts = attempts;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry only on network failures and transient HTTP statuses. */
function isRetryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * fetch with retries and exponential backoff.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{attempts?:number, baseDelayMs?:number, retryOn?:Function}} [policy]
 */
async function fetchWithRetry(url, options = {}, policy = {}) {
  const attempts = policy.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const retryOn = policy.retryOn ?? isRetryable;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || !retryOn(response.status)) {
        return response;
      }
      lastError = new HttpError(`HTTP ${response.status} ${response.statusText}`, {
        status: response.status,
        attempts: attempt,
      });
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  throw new HttpError(
    `Request failed after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`,
    { status: lastError?.status ?? null, attempts }
  );
}

/** GET JSON with retries. Throws on a non-2xx response after retries. */
async function fetchJson(url, options = {}, policy = {}) {
  const response = await fetchWithRetry(url, options, policy);
  if (!response.ok) {
    throw new HttpError(`HTTP ${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`, {
      status: response.status,
    });
  }
  return response.json();
}

/** GET text with retries. Throws on a non-2xx response after retries. */
async function fetchText(url, options = {}, policy = {}) {
  const response = await fetchWithRetry(url, options, policy);
  if (!response.ok) {
    throw new HttpError(`HTTP ${response.status} ${response.statusText}`, { status: response.status });
  }
  return response.text();
}

module.exports = {
  HttpError,
  fetchWithRetry,
  fetchJson,
  fetchText,
  isRetryable,
};
