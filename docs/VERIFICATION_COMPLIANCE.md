# n8n Verification Compliance

Last checked against official documentation: 2026-07-30

## Current program and process

n8n currently uses **Verified Node Partner** for the partner program and
**verified community nodes** for packages accepted through verification.
SallaFlow is presently only an n8n community node.

The current flow is:

1. build and publish a compliant community-node package
2. publish it from a public GitHub repository with npm provenance
3. add the npm package in n8n Creator Portal
4. prove npm package ownership with the one-time code sent to an author email
5. pass automated checks
6. provide the requested manual-review evidence, including the short uncut
   demonstration video
7. wait for n8n approval

Since 2026-05-01, n8n's verification guidance requires provenance for new
verification submissions. For npm packages published through GitHub Actions,
the current supported model is npm Trusted Publishing with GitHub OIDC.

## Compliance matrix

`Prepared` means repository evidence exists but must still pass on the final
clean release commit. `Pending` means an owner or external reviewer action is
still required.

| Requirement                                     | Current evidence                                                                                                           | Status                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Public npm community-node package               | Package name and manifest are prepared; exact 0.6.2 registry release does not yet exist unless npm shows it                | Pending publication                |
| Public GitHub repository                        | This clean node-only source is prepared for `MoMorgan1/n8n-nodes-sallaflow`; the release gate verifies the public URL      | Prepared, public URL check pending |
| GitHub Actions provenance                       | Tag-release design uses npm Trusted Publishing/OIDC and `--provenance`                                                     | Pending published run              |
| MIT license                                     | Root `LICENSE` and package metadata                                                                                        | Prepared                           |
| Official n8n build tool                         | `@n8n/node-cli` is pinned and used for build, lint, and prerelease validation                                              | Prepared                           |
| Supported Node.js toolchain                     | Package requires Node.js 22.22.0 or newer; CI must pin the exact validation version                                        | Prepared                           |
| n8n community-node keyword and manifest entries | Package metadata declares the node and credential entry points                                                             | Prepared                           |
| TypeScript and English UI text                  | Node and credential source are TypeScript with English-facing metadata                                                     | Prepared                           |
| No runtime npm dependencies                     | Package has no `dependencies` entries; `n8n-workflow` is a peer dependency                                                 | Prepared                           |
| No environment or filesystem access             | Runtime source must pass final official linter and repository scan                                                         | Prepared, final scan required      |
| One external service                            | Node directly calls only SallaFlow, but SallaFlow intermediates Salla OAuth and Merchant API access                        | n8n confirmation recommended       |
| Credential-based authentication                 | Password-style SallaFlow integration-key credential with HTTPS credential test                                             | Prepared                           |
| Useful action surface                           | 46 operations across 11 resources                                                                                          | Prepared                           |
| Trigger support                                 | Webhook Trigger v2 with 64 canonical events and one compatibility alias                                                    | Prepared                           |
| Trigger-delivery authenticity                   | Capability webhook URLs are used; no separate SallaFlow delivery signature exists, and this is disclosed                   | Reviewer decision recommended      |
| AI-tool usability                               | Action node is configured for tool use; manual review must demonstrate a safe action                                       | Prepared, demonstration pending    |
| Stable saved workflows                          | Action v5, Trigger v2, public 0.5.2 fixture, deployment fixture, and an exact namespace migration tool                     | Prepared, clean test pending       |
| Documentation                                   | Install, credentials, examples, operations, events, limitations, security, privacy, terms, support, and uninstall guidance | Prepared                           |
| Sensitive-data exclusion                        | Repository and tarball scan scripts/checks are prepared                                                                    | Full tree and history scan pending |
| Official lint and security scan                 | `npm run lint`, `n8n-node prerelease`, tests, manifest and security checks                                                 | Clean release run pending          |
| Package allowlist                               | Package `files` allowlist and pack-content validation                                                                      | Clean pack inspection pending      |
| Public support channel                          | `info@sallaflow.cloud` and public troubleshooting/security guidance                                                        | Prepared                           |
| Creator Portal ownership proof                  | Requires code sent to npm author email                                                                                     | Owner action pending               |
| Manual-review video                             | Script prepared for install, credential, common actions, Trigger, and AI-tool use                                          | Recording pending                  |
| Official-representative profile                 | Requires authorized submitter and post-approval brand/company fields                                                       | Owner action pending               |
| n8n Cloud availability                          | Available only if and when n8n approves the package                                                                        | Not approved                       |

## External SaaS review point

n8n's eligibility guidance expects one service per community-node package.
SallaFlow is the only origin called by the node, but it intentionally manages
Salla OAuth and proxies authorized Salla Merchant API calls. This architecture
is central to the product and must be disclosed in the submission.

The safest course is to ask n8n to confirm eligibility during review rather
than describing the node as a direct Salla integration or hiding the external
backend. The public privacy notice and submission dossier explain the complete
data flow.

Other community packages already integrate with Salla. SallaFlow should be
reviewed as its own SaaS service and differentiated by its managed OAuth,
quota, proxy, and webhook boundary. n8n must decide whether that is sufficiently
distinct for verification; the submission must not imply that eligibility is
already settled.

## Security and compatibility review points

Trigger delivery currently treats the registered n8n production webhook URL
as a secret capability. SallaFlow does not add a separate application-level
delivery signature. Users must keep the URL private, require HTTPS, and rotate
it if exposed. This limitation is documented for users and should be called
out to n8n reviewers.

Workflows created from the public npm package use the
`n8n-nodes-sallaflow.*` namespace. A workflow exported from the private hosted
deployment may instead contain `CUSTOM.sallaFlow` or
`CUSTOM.sallaFlowTrigger`; n8n does not alias those identifiers automatically.
The repository therefore includes a narrow, offline migration command that
changes only those two exact type values. It does not ship in the runtime
tarball.

## Project-added release controls

The following controls go beyond the minimum form fields and are retained for
release integrity:

- clean node-only history with no private monorepo history
- full worktree, history, generated-file, fixture, and tarball scans
- two independent pack operations with checksum comparison
- source/dist consistency and package-content allowlist checks
- compatibility fixtures for the old public and deployment-baseline node
  shapes
- fresh local-tarball and post-publication registry installations
- explicit approval gates for npm publication and final Creator Portal
  submission

## Official sources

- [n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/)
- [Submit community nodes](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes/)
- [n8n node development tool](https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool/)
- [n8n UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines/)
- [n8n community-node installation](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/)
- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/reference/security/oidc)

Recheck these sources and the live Creator Portal before each submission.
