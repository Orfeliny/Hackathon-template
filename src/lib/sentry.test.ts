import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";
import { initSentry, scrubBreadcrumb, scrubEvent, scrubUrl } from "./sentry";

const sentryInit = vi.hoisted(() => vi.fn());
vi.mock("@sentry/react", () => ({ init: sentryInit }));

const baseEvent = (overrides: Partial<ErrorEvent>): ErrorEvent => ({
  type: undefined,
  ...overrides,
});

describe("initSentry", () => {
  beforeEach(() => {
    sentryInit.mockClear();
  });

  it("never loads or initialises Sentry without a DSN", async () => {
    const started = await initSentry({
      dsn: undefined,
      environment: "production",
      release: undefined,
    });
    expect(started).toBe(false);
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("initialises with scrubbing hooks when a DSN is set", async () => {
    const started = await initSentry({
      dsn: "https://key@o1.ingest.sentry.io/1",
      environment: "production",
      release: "abc123",
    });
    expect(started).toBe(true);
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
        environment: "production",
        release: "abc123",
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      }),
    );
  });
});

describe("DSN env parsing", () => {
  it("treats a missing or empty DSN as unset", () => {
    expect(parseEnv({}).sentryDsn).toBeUndefined();
    expect(parseEnv({ VITE_SENTRY_DSN: "" }).sentryDsn).toBeUndefined();
  });

  it("accepts a valid DSN and rejects garbage", () => {
    const dsn = "https://key@o1.ingest.sentry.io/1";
    expect(parseEnv({ VITE_SENTRY_DSN: dsn }).sentryDsn).toBe(dsn);
    expect(() => parseEnv({ VITE_SENTRY_DSN: "nope" })).toThrow(
      /VITE_SENTRY_DSN/,
    );
  });

  it("passes the commit SHA through as the release", () => {
    expect(parseEnv({ VITE_COMMIT_SHA: " abc " }).commitSha).toBe("abc");
    expect(parseEnv({ VITE_COMMIT_SHA: "" }).commitSha).toBeUndefined();
  });
});

describe("scrubUrl", () => {
  it("filters token-like query and fragment values only", () => {
    expect(
      scrubUrl("/cb?code=1&access_token=secret&page=2#id_token=xyz&ok=1"),
    ).toBe(
      "/cb?code=1&access_token=[Filtered]&page=2#id_token=[Filtered]&ok=1",
    );
  });

  it("survives malformed percent-encoding", () => {
    expect(scrubUrl("/x?a%zz=1&token=2")).toBe("/x?a%zz=1&token=[Filtered]");
  });

  it("filters AI-related parameters but keeps look-alikes", () => {
    expect(scrubUrl("/x?ai=hi&aiModel=m&email=a&detail=b")).toBe(
      "/x?ai=[Filtered]&aiModel=[Filtered]&email=a&detail=b",
    );
  });
});

describe("scrubEvent", () => {
  it("drops request bodies and cookies and scrubs headers and URLs", () => {
    const event = scrubEvent(
      baseEvent({
        request: {
          url: "https://app.test/page?token=abc&view=1",
          query_string: "apiKey=k&view=1",
          data: { prompt: "tell me secrets" },
          cookies: { session: "s" },
          headers: { Authorization: "Bearer x", Accept: "text/html" },
        },
      }),
    );
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.url).toBe(
      "https://app.test/page?token=[Filtered]&view=1",
    );
    expect(event.request?.query_string).toBe("apiKey=[Filtered]&view=1");
    expect(event.request?.headers).toEqual({
      Authorization: "[Filtered]",
      Accept: "text/html",
    });
  });

  it("redacts sensitive keys at any depth in extra, contexts and tags", () => {
    const event = scrubEvent(
      baseEvent({
        extra: {
          prompt: "p",
          nested: { list: [{ AI_API_KEY: "k", keep: 1 }], password: "pw" },
          aiResponse: "r",
          email: "kept",
        },
        contexts: { custom: { authorization: "a", note: "n" } },
        tags: { token: "t", area: "notes" },
      }),
    );
    expect(event.extra).toEqual({
      prompt: "[Filtered]",
      nested: {
        list: [{ AI_API_KEY: "[Filtered]", keep: 1 }],
        password: "[Filtered]",
      },
      aiResponse: "[Filtered]",
      email: "kept",
    });
    expect(event.contexts).toEqual({
      custom: { authorization: "[Filtered]", note: "n" },
    });
    expect(event.tags).toEqual({ token: "[Filtered]", area: "notes" });
  });

  it("scrubs breadcrumbs inside the event and drops console ones", () => {
    const event = scrubEvent(
      baseEvent({
        breadcrumbs: [
          { category: "console", message: "prompt: hello" },
          {
            category: "fetch",
            data: { url: "/api?token=1", body: "{}", method: "POST" },
          },
        ],
      }),
    );
    expect(event.breadcrumbs).toEqual([
      {
        category: "fetch",
        data: { url: "/api?token=[Filtered]", method: "POST" },
      },
    ]);
  });

  it("does not mutate the original event", () => {
    const original = baseEvent({
      request: { data: "x", url: "/a?token=1" },
      extra: { prompt: "p" },
    });
    scrubEvent(original);
    expect(original.request?.data).toBe("x");
    expect(original.extra).toEqual({ prompt: "p" });
  });
});

describe("scrubBreadcrumb", () => {
  it("returns breadcrumbs without data untouched", () => {
    const crumb: Breadcrumb = { category: "ui.click", message: "button" };
    expect(scrubBreadcrumb(crumb)).toBe(crumb);
  });

  it("filters navigation URLs", () => {
    expect(
      scrubBreadcrumb({
        category: "navigation",
        data: { from: "/a", to: "/b?password=1" },
      }),
    ).toEqual({
      category: "navigation",
      data: { from: "/a", to: "/b?password=[Filtered]" },
    });
  });
});
