type Level = "debug" | "info" | "warn" | "error";

/** Structured JSON logs on stdout. Never pass secrets or raw file contents. */
function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => process.env.NODE_ENV !== "production" && log("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => log("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => log("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => log("error", msg, f),
};

export function errorFields(err: unknown) {
  if (err instanceof Error) return { error: err.message, name: err.name };
  return { error: String(err) };
}
