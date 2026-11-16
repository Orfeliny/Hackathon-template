import { z } from "zod";

// An empty string means "unset": .env.e2e blanks the URL to force offline mode.
const envSchema = z.object({
  VITE_CONVEX_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(z.url({ message: "must be a valid URL" }).optional()),
});

export type Env = { convexUrl: string | undefined };

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid frontend environment: ${details}`);
  }
  return { convexUrl: result.data.VITE_CONVEX_URL };
}

export function getEnv(): Env {
  return parseEnv(import.meta.env);
}
