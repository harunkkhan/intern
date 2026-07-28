// Fetch with a timeout and bounded retries. Every adapter goes through this, so
// a single flaky careers page slows one source down instead of failing the run.

const TIMEOUT_MS = 20_000;
const RETRIES = 2;

// Some ATS hosts (Workday especially) reject requests without a browser-ish UA.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 intern-alerts/1.0";

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  accept?: string;
}

async function once(url: string, options: RequestOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: options.accept ?? "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await once(url, options);
      // 4xx other than 429 is a config problem (bad board token, renamed
      // tenant) — retrying wastes time and hides the real cause.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} ${res.statusText}`), {
          fatal: true,
        });
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && "fatal" in err) throw err;
      if (attempt === RETRIES) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const res = await request(url, options);
  return (await res.json()) as T;
}

export async function getText(
  url: string,
  options: RequestOptions = {},
): Promise<string> {
  const res = await request(url, { accept: "text/html,*/*", ...options });
  return await res.text();
}
