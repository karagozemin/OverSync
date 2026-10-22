# Foundry setup for Slither

The Slither job in `.github/workflows/contracts.yml` installs Foundry once with `foundry-rs/foundry-toolchain@v1`.

`forge --version` runs after that setup and before `slither`, so analysis does not start when Forge is missing from `PATH`.
