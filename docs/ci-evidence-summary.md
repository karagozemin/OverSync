# CI Evidence Summary Artifact

## What the artifact contains
- **File name:** `evidence-summary.md`
- **Commit SHA** – the exact commit that triggered the workflow.
- **Workflow name & ID** – `GITHUB_WORKFLOW`, `GITHUB_RUN_ID`, `GITHUB_RUN_NUMBER`.
- **Timestamp** – ISO‑8601 timestamp when the script ran.
- **Git reference** – full ref (`GITHUB_REF`) and branch/PR (`GITHUB_HEAD_REF` when applicable).
- **Packages / services tested** – can be populated via the optional `CI_PACKAGES_TESTED` env var.
- **Build commands** – optional `CI_BUILD_COMMANDS` env var.
- **Test commands** – optional `CI_TEST_COMMANDS` env var.
- **Overall build status** – derived from `JOB_STATUS` (success/failure).
- **Overall test status** – derived from `JOB_STATUS`.
- **Artifact links** – optional `CI_ARTIFACT_LINKS` env var (e.g., URLs of other uploaded artifacts).

## Where it is generated
The file is generated inside the CI runner’s workspace by the script:
```
node scripts/generate-ci-evidence.mjs
```
which is executed in each job (TypeScript and Soroban) after the regular build/test steps.

## How reviewers can download it
1. Open the **Actions** tab in the repository.
2. Select the desired workflow run (either a PR run or a `main`/`master` run).
3. In the run summary, locate the **Artifacts** section.
4. Click on the artifact named **`ci-evidence-summary`**.
5. Download the `evidence-summary.md` file and open it.

The artifact is uploaded automatically by the workflow step:
```yaml
- name: Upload CI evidence summary
  uses: actions/upload-artifact@v4
  with:
    name: ci-evidence-summary
    path: evidence-summary.md
```

## Security note
The script only includes safe metadata supplied by GitHub Actions. No secrets, tokens, environment variable values, or private URLs are written to the summary.
