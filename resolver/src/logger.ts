import pino, { type Logger } from "pino";
import { redactLogObject } from "@oversync/sdk/logging";

let logger: Logger | null = null;

export function getLogger(level: string = "info"): Logger {
  if (!logger) {
    logger = pino({
      level,
      formatters: {
        log: (object) => redactLogObject(object)
      },
      transport: process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino/file", options: { destination: 1 } }
    });
  }
  return logger;
}
