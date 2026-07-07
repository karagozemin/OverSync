import pino, { type Logger } from "pino";
import { redactLogObject } from "@oversync/sdk/logging";

let cached: Logger | null = null;

export function getLogger(level: string = "info"): Logger {
  if (!cached) {
    cached = pino({
      level,
      base: { service: "oversync-coordinator" },
      formatters: {
        log: (object) => redactLogObject(object)
      }
    });
  }
  return cached;
}
