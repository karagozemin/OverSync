import type { ZodError, ZodIssue } from "zod";

/**
 * Stable response body for a request that failed schema validation.
 *
 * `fields` names the offending request keys / paths only. Submitted values are
 * never copied into the response: a mistyped secret or address must not be
 * reflected back to the caller (or into logs that capture response bodies).
 */
export interface ValidationErrorResponse {
  error: "validation_error" | "unknown_field";
  message: string;
  fields: string[];
}

function fieldPath(issue: ZodIssue): string | null {
  const path = issue.path.map(String).join(".");
  return path ? path : null;
}

/**
 * Build the response for a `ZodError`.
 *
 * When every issue is an unrecognized key the request is answered with the
 * dedicated `unknown_field` code, so a client can tell a misspelled hashlock
 * or timelock apart from a value that failed a rule. Mixed payloads keep the
 * generic `validation_error` code and name every offending field.
 */
export function validationErrorResponse(err: ZodError): ValidationErrorResponse {
  const fields = new Set<string>();
  let hasValueIssue = false;

  for (const issue of err.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields.add(key);
      continue;
    }
    hasValueIssue = true;
    const path = fieldPath(issue);
    if (path) fields.add(path);
  }

  const sortedFields = [...fields].sort();

  if (!hasValueIssue && sortedFields.length > 0) {
    return {
      error: "unknown_field",
      message: "Request payload contains unknown fields",
      fields: sortedFields
    };
  }

  return {
    error: "validation_error",
    message: "Request payload failed validation",
    fields: sortedFields
  };
}
