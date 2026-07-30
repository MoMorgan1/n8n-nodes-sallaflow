# Changelog

All notable public changes to `n8n-nodes-sallaflow` are documented here.
Versions follow Semantic Versioning.

## [0.6.2] - Unreleased

0.6.2 is the planned public release version. It must remain marked
**Unreleased** until the exact package is published to npm.

### Added

- Action type version 5 with 46 operations across 11 Salla resources
- Trigger type version 2 with 64 canonical events
- A compatibility alias for the legacy `shipment.return.creating` trigger
  value, giving 65 selectable trigger choices
- Product Option and Product Variant operations
- Abandoned Cart and Feedback read operations
- Guided inventory, product-image, and brand-logo operations
- Public catalogue contracts, saved-workflow compatibility fixtures, and
  release validation checks
- Sanitized importable workflow fixtures for the public npm 0.5.2 namespace
  and the hosted/custom 0.6.1 namespace
- A non-overwriting migration/check helper for converting only
  `CUSTOM.sallaFlow` and `CUSTOM.sallaFlowTrigger` workflow-node types to their
  public package-qualified equivalents
- Public contribution, security, privacy, terms, troubleshooting, release, and
  verification documentation

### Changed

- The package uses a SallaFlow integration key obtained from the merchant
  dashboard.
- Public release validation uses the official `@n8n/node-cli` toolchain.
- Release publishing is designed for npm Trusted Publishing through GitHub
  Actions with provenance and no long-lived npm token.

### Compatibility

- The node identifiers remain `sallaFlow` and `sallaFlowTrigger`.
- The intended compatibility baseline is public npm version 0.5.2.
- Action v5 and Trigger v2 are preserved for the planned release.
- Public npm 0.5.2 workflows already use the package-qualified node types and
  require no namespace migration.
- Workflows exported from a local/custom loader use `CUSTOM.*` node types,
  which n8n does not automatically alias to an npm-installed package. The
  included helper performs the required exact-type migration while preserving
  node versions, parameters, connections, and credential references.
- Compatibility claims become release evidence only after the clean
  release-candidate validation described in
  [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) passes.

## [0.5.2]

Previous public npm release and saved-workflow compatibility baseline. Consult
the npm registry for its publication metadata.

[0.6.2]: https://github.com/MoMorgan1/n8n-nodes-sallaflow/releases/tag/v0.6.2
[0.5.2]: https://www.npmjs.com/package/n8n-nodes-sallaflow/v/0.5.2
