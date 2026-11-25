# Stellar CLI in CI

The Soroban job installs Stellar CLI once, at the pinned release `22.8.1`, through `cargo binstall`.

`stellar --version` runs once after that install. A second `cargo install --locked stellar-cli` step is not part of the job: that build fails on current stable Rust because stellar-cli 22.8.1 depends on ethnum 1.5.0.
