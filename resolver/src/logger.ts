import pino, { type Logger } from "pino";
import { redactLogObject } from "@oversync/sdk/logging";

let logger: Logger | null = null;

// Regular expressions targeting standard security leaks
const PRIVATE_KEY_REGEX = /\b(0x)?[a-fA-F0-9]{64}\b/g;
const RPC_CREDENTIALS_REGEX = /([a-zA-Z]+:\/\/)([^/:]+):([^/]+)@/g;
const BEARER_TOKEN_REGEX = /(Bearer\s+|api[-_]?key\s*[:=]\s*|Token\s+)[A-Za-z0-9-_=.]+/gi;
const MNEMONIC_REGEX = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi;
const PREIMAGE_SECRET_REGEX = /\b(secret|preimage|secretKey|token|password)\s*[:=]\s*["']?([a-fA-F0-9\-_{}]+)["']?/gi;

/**
 * Utility to redact sensitive parameters from resolver telemetry logs string values
 */
export function redactLog(message: string): string {
  if (!message || typeof message !== "string") return message;

  let sanitized = message;
  sanitized = sanitized.replace(RPC_CREDENTIALS_REGEX, "$1[REDACTED]:[REDACTED]@");
  sanitized = sanitized.replace(BEARER_TOKEN_REGEX, "$1[REDACTED]");
  sanitized = sanitized.replace(PRIVATE_KEY_REGEX, "[REDACTED_KEY]");
  sanitized = sanitized.replace(MNEMONIC_REGEX, "[REDACTED_MNEMONIC]");
  sanitized = sanitized.replace(PREIMAGE_SECRET_REGEX, "$1: [REDACTED]");

  return sanitized;
}

/**
 * Deep recursive object sanitizer to ensure credentials hidden inside
 * structured log objects (like metadata dumps or parsed JSON configs) are also caught.
 */
function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== "object") {
    return typeof obj === "string" ? redactLog(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitizedObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      sanitizedObj[key] = redactLog(value);
    } else if (typeof value === "object") {
      sanitizedObj[key] = sanitizeObject(value);
    } else {
      sanitizedObj[key] = value;
    }
  }
  return sanitizedObj;
}

export function getLogger(level: string = "info"): Logger {
  if (!logger) {
    logger = pino({
      level,
      formatters: {
        log: (object) => redactLogObject(object)
      },
      transport: process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino/file", options: { destination: 1 } },

      // Use Pino's native logMethod hook to intercept all statements transparently
      hooks: {
        logMethod(inputArgs, method) {
          const sanitizedArgs = inputArgs.map(arg => {
            if (typeof arg === "string") {
              return redactLog(arg);
            } else if (typeof arg === "object") {
              return sanitizeObject(arg);
            }
            return arg;
          });

          return method.apply(this, sanitizedArgs as [string, ...any[]]);
        }
      }
    });
  }
  return logger;
}