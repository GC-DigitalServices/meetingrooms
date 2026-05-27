import { ConfidentialClientApplication } from "@azure/msal-node";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_ATTEMPTS = 4;

// MSAL app singleton — reused across requests so the token cache is shared.
let _msalApp: ConfidentialClientApplication | undefined;

function getMsalApp(): ConfidentialClientApplication {
  if (_msalApp) return _msalApp;
  const cfg = getConfig();
  _msalApp = new ConfidentialClientApplication({
    auth: {
      clientId: cfg.AZURE_CLIENT_ID,
      clientSecret: cfg.AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${cfg.AZURE_TENANT_ID}`,
    },
  });
  return _msalApp;
}

async function acquireToken(): Promise<string> {
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("MSAL returned no access token");
  return result.accessToken;
}

async function graphFetch(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  attempt = 1
): Promise<unknown> {
  const token = await acquireToken();

  const res = await fetch(
    path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }
  );

  if (res.ok) {
    if (res.status === 204) return undefined;
    return res.json();
  }

  const isRetryable = res.status === 429 || (res.status >= 500 && res.status < 600);

  if (isRetryable && attempt < MAX_ATTEMPTS) {
    const retryAfter = res.headers.get("Retry-After");
    const delaySec = retryAfter ? parseInt(retryAfter, 10) : Math.pow(2, attempt);
    logger.warn({ status: res.status, attempt, delaySec }, "graph: retryable error, backing off");
    await new Promise((r) => setTimeout(r, delaySec * 1000));
    return graphFetch(method, path, body, extraHeaders, attempt + 1);
  }

  const errorBody = await res.text().catch(() => "(no body)");
  logger.error({ status: res.status, method, path }, "graph: graph_api_error");
  throw new Error(`Graph HTTP ${res.status}: ${errorBody}`);
}

// Calendar-related requests should return times in UTC.
const CALENDAR_HEADERS = { Prefer: 'outlook.timezone="UTC"' };

export const graphClient = {
  get: <T>(path: string, headers?: Record<string, string>): Promise<T> =>
    graphFetch("GET", path, undefined, headers) as Promise<T>,

  getCalendar: <T>(path: string): Promise<T> =>
    graphFetch("GET", path, undefined, CALENDAR_HEADERS) as Promise<T>,

  post: <T>(path: string, body: unknown): Promise<T> =>
    graphFetch("POST", path, body) as Promise<T>,

  patch: <T>(path: string, body: unknown): Promise<T> =>
    graphFetch("PATCH", path, body) as Promise<T>,

  delete: (path: string): Promise<void> =>
    graphFetch("DELETE", path) as Promise<void>,
};
