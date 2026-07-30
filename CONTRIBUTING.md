# Contributing

Thank you for helping improve SallaFlow's n8n community node.

## Repository scope

This repository is the canonical source for the public
`n8n-nodes-sallaflow` package. It contains only the node, credentials
definition, public contracts, tests, examples, documentation, and release
automation.

Do not add:

- SallaFlow backend, deployment, database, or VPS source
- credentials, tokens, private keys, merchant or customer data
- private hostnames, IP addresses, operator paths, or internal runbooks
- raw API or end-to-end responses from a real store
- generated source maps or fixtures that contain sensitive values

Use synthetic identifiers and `.example` domains in tests and documentation.
Public Salla, n8n, npm, GitHub, and SallaFlow service URLs are acceptable when
they are required for the node.

## Development setup

Install Node.js 22.22.0 or newer, clone the repository, and install the locked
dependencies:

```bash
npm ci
```

Useful commands:

```bash
npm run build
npm run dev
npm run lint
npm test
npm run test:coverage
npm run test:saved-workflows
npm run check:manifest
npm run check:security
npm run pack:check
npm run validate
```

`npm run validate` is the normal pre-review check. It runs the n8n linter,
tests with coverage thresholds, a reproducible build check, catalogue-manifest
validation, the public-repository security scan, and package-content checks.

## Making a change

1. Open an issue for a substantial behavior or compatibility change.
2. Branch from the current public default branch.
3. Keep the change focused on the public node.
4. Add or update tests and catalogue contracts for behavior changes.
5. Update the README and changelog when users will observe the change.
6. Run `npm run validate`.
7. Inspect the diff for private information before opening a pull request.

Do not change existing node names, credential names, parameter values, Action
type version, or Trigger type version without a documented migration and
saved-workflow compatibility tests.

## Backend compatibility

The public node deliberately depends on the documented SallaFlow service
interface but does not contain the private backend implementation. A backend
change and a node change should be reviewed independently:

- Merge a node release only after its public API assumptions are approved.
- Test compatibility against an authorized non-customer test store.
- Never copy backend source or operational fixtures into this repository.
- Prefer additive, backward-compatible service changes.

## Tests and fixtures

Tests must not require customer data. Use deterministic synthetic payloads and
identifiers. Saved-workflow fixtures may contain only the minimum node
metadata and parameter shapes needed to demonstrate compatibility.

When an external compatibility check is necessary, keep credentials outside
the repository and limit the check to read-only operations unless a separate
test-store plan explicitly authorizes a write.

## Pull requests

Describe:

- the user-facing problem and solution
- compatibility impact
- validation commands run
- whether the SallaFlow backend contract changes
- any documentation, security, or privacy impact

By contributing, you agree that your contribution is licensed under the
repository's [MIT License](LICENSE).
