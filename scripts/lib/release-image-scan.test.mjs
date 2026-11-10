import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { verifyReleaseImageScanGate } from "./release-image-scan.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

describe("resolver image pre-publication vulnerability scan (#373)", () => {
  it("runs a blocking HIGH/CRITICAL Trivy scan on the locally built resolver image before push", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = verifyReleaseImageScanGate(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected image scan violations: ${result.violations.join("; ")}`,
    );
    assert.equal(result.severity, "HIGH,CRITICAL");
  });

  it("rejects workflows where Trivy runs after push or does not fail on findings", () => {
    const postPushScan = `
      - uses: docker/build-push-action@v6
      - run: docker buildx build --load --file ./resolver/Dockerfile --tag oversync-resolver:scan ./resolver
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          exit-code: '1'
          severity: HIGH,CRITICAL
`;
    const orderCheck = verifyReleaseImageScanGate(postPushScan);
    assert.equal(orderCheck.ok, false);
    assert.ok(
      orderCheck.violations.some((v) => v.includes("before docker/build-push-action")),
    );

    const nonBlockingScan = `
      - run: docker buildx build --load --file ./resolver/Dockerfile --tag oversync-resolver:scan ./resolver
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          exit-code: '0'
          severity: HIGH,CRITICAL
      - uses: docker/build-push-action@v6
`;
    const blockingCheck = verifyReleaseImageScanGate(nonBlockingScan);
    assert.equal(blockingCheck.ok, false);
    assert.ok(blockingCheck.violations.some((v) => v.includes("exit-code: '1'")));
  });
});
