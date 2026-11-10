# Resolver container release SBOM generation

`.github/workflows/release.yml` enables BuildKit SBOM attestations (`sbom: true`) on `docker/build-push-action@v6` and generates a standalone CycloneDX JSON SBOM (`resolver-sbom.cdx.json`) via `anchore/sbom-action@v0` for the released resolver image.

The generated SBOM artifact (`resolver-sbom-${{ github.ref_name }}`) is uploaded via `actions/upload-artifact@v4` with `retention-days: 14`.
