import type { Breadcrumb, ErrorEvent } from "@sentry/react";

const FILTERED = "[Filtered]";
const MAX_DEPTH = 8;

const SENSITIVE_KEY =
  /prompt|api[-_]?key|token|authorization|password|secret|cookie|credential/i;
// Case-sensitive on purpose: a bare /ai/i would also hit "email" or "detail".
const AI_KEY = /(^|[-_.])(ai|AI)($|[-_.A-Z])/;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || AI_KEY.test(key);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function scrubUrl(url: string): string {
  return url.replace(
    /([?&;#])([^=&#;]*)=([^&#;]*)/g,
    (match, sep: string, key: string) =>
      isSensitiveKey(safeDecode(key)) ? `${sep}${key}=${FILTERED}` : match,
  );
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        isSensitiveKey(key) ? FILTERED : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console output can carry prompts or model answers.
  if (breadcrumb.category === "console") return null;
  if (!breadcrumb.data) return breadcrumb;
  const data = redact(breadcrumb.data) as Record<string, unknown>;
  for (const key of ["body", "request_body", "requestBody"]) delete data[key];
  if (typeof data.url === "string") data.url = scrubUrl(data.url);
  if (typeof data.from === "string") data.from = scrubUrl(data.from);
  if (typeof data.to === "string") data.to = scrubUrl(data.to);
  return { ...breadcrumb, data };
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };
  if (event.request) {
    const request = { ...event.request };
    delete request.data;
    delete request.cookies;
    if (request.headers) {
      request.headers = redact(request.headers) as Record<string, string>;
    }
    if (request.url) request.url = scrubUrl(request.url);
    if (typeof request.query_string === "string") {
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string) {
      request.query_string = redact(request.query_string) as never;
    }
    scrubbed.request = request;
  }
  if (event.extra) scrubbed.extra = redact(event.extra) as typeof event.extra;
  if (event.contexts) {
    scrubbed.contexts = redact(event.contexts) as typeof event.contexts;
  }
  if (event.tags) scrubbed.tags = redact(event.tags) as typeof event.tags;
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return scrubbed;
}

export type SentryOptions = {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
};

// The dynamic import keeps @sentry/react out of the default bundle: it is only fetched with a DSN.
export async function initSentry(options: SentryOptions): Promise<boolean> {
  if (!options.dsn) return false;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
}
