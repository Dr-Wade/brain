import { pino, type LoggerOptions } from "pino";

// Paths whose values never reach a log line. pino-http logs request headers,
// so the session cookie and any bearer token are covered here.
const REDACT = [
    "req.headers.cookie",
    "req.headers.authorization",
    "res.headers[\"set-cookie\"]",
    "*.password",
    "*.token",
    "*.secret"
];

/**
 * pino options shared by the API (through nestjs-pino) and
 * scripts: JSON lines to stdout, which is all the deployment needs to collect.
 * LOG_LEVEL overrides the level; tests are silent unless it is set.
 */
export function loggerOptions (env: NodeJS.ProcessEnv = process.env): LoggerOptions {
    const fallback = env.NODE_ENV === "test" ? "silent" : "info";
    return {
        level: env.LOG_LEVEL || fallback,
        redact: { paths: REDACT, censor: "[redacted]" }
    };
}

export function createLogger (name: string, env: NodeJS.ProcessEnv = process.env) {
    return pino({ ...loggerOptions(env), name });
}
