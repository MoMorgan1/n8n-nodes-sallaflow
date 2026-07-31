# n8n Creator Portal Submission Package

Status: **Prepared, not submitted; authenticated demonstration required**

The public repository and npm release now exist, and the current official
registry scanner passes. This dossier does not claim n8n approval. Complete
the authenticated demonstration before submission. Recheck the live Creator
Portal and current official instructions immediately before submission
because form fields can change.

## Package identity

| Field                   | Prepared value                                      |
| ----------------------- | --------------------------------------------------- |
| Node                    | SallaFlow                                           |
| npm package             | `n8n-nodes-sallaflow`                               |
| Published version       | `0.6.3`                                             |
| npm URL                 | `https://www.npmjs.com/package/n8n-nodes-sallaflow` |
| GitHub repository       | `https://github.com/MoMorgan1/n8n-nodes-sallaflow`  |
| Documentation           | Repository `README.md`                              |
| License                 | MIT                                                 |
| Support                 | `info@sallaflow.cloud`                              |
| Product website         | `https://sallaflow.cloud`                           |
| Privacy                 | `https://sallaflow.cloud/privacy.html`              |
| Terms                   | `https://sallaflow.cloud/terms.html`                |
| Node privacy supplement | Repository `docs/PRIVACY.md`                        |
| Action type version     | 5                                                   |
| Trigger type version    | 2                                                   |
| Catalogue               | 11 resources, 46 operations                         |
| Trigger catalogue       | 64 canonical events, 65 selectable choices          |

Publication evidence:

- Release commit: `3c4e1b54f4a9cd7bc1166cc29493ed958e94986c`
- Protected tag: `v0.6.3`
- Registry tarball SHA-256:
  `1931d9e345b162733d08951ce702a667ae5e14aa6003ab94c393323f86f54d4c`
- [GitHub Actions publication run](https://github.com/MoMorgan1/n8n-nodes-sallaflow/actions/runs/30613237411)
- [npm provenance attestation](https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-sallaflow@0.6.3)
- Registry-install validation: passed on fresh n8n 2.32.6 and 2.6.3
- Official scanner: `@n8n/scan-community-package@0.30.0` passed provenance,
  source retrieval, package download, and analysis

## Program terminology

n8n currently calls its partner-facing program **Verified Node Partner** and
calls accepted packages **verified community nodes** in its product
documentation. Until approval, every public description must say only
**n8n community node**.

## Short description

Use this 250–300 character description if it fits the live form:

> SallaFlow connects Salla stores to n8n through secure Merchant API actions
> and real-time event triggers. Build workflows for orders, products,
> customers, inventory, coupons, abandoned carts, and more while SallaFlow
> manages Salla OAuth and webhook delivery.

## Applicant and service relationship

Creator Portal asks whether the submitter officially represents the integrated
service. Select **Yes** only if the logged-in submitter is authorized to
represent SallaFlow. Record the authorized person's name and business contact
in the private submission, not in repository fixtures.

Selecting this option describes the submitter's relationship to SallaFlow. It
does not claim endorsement by n8n or Salla.

The npm ownership check sends a one-time code to an npm package-author email.
The npm owner must be available to receive and enter that code.

## Authentication explanation

Users install the SallaFlow app, connect their Salla store to a SallaFlow
account, and obtain an integration key from the SallaFlow merchant dashboard.
The n8n credential sends the key in the `X-SallaFlow-Key` header over HTTPS to
`https://api.sallaflow.cloud`.

The public node never receives Salla OAuth client secrets or refresh tokens.
The SallaFlow backend identifies the merchant represented by the integration
key, manages Salla OAuth and token refresh, enforces quotas, and calls the
Salla Merchant API.

## External backend and data flow

SallaFlow is the single external service directly integrated by the node. It
provides a public SaaS boundary for Salla OAuth, Merchant API access, quota
admission, safe read retries, and webhook delivery.

Action flow:

```text
n8n → SallaFlow API → Salla Merchant API → SallaFlow API → n8n
```

Trigger flow:

```text
Salla → SallaFlow webhook service → registered n8n production webhook
```

The reviewer should be told plainly that SallaFlow is an intermediary for the
merchant's Salla account. Ask n8n to confirm that this single-service SaaS
architecture satisfies its one-service eligibility rule; do not hide the
proxy relationship.

Data categories and user controls are documented in
[`PRIVACY.md`](PRIVACY.md). Users can deactivate triggers, delete the n8n
credential, rotate the SallaFlow key, and uninstall the package.

## Security controls

- fixed HTTPS SallaFlow API origin
- password-style n8n credential using a merchant-scoped integration key
- Salla OAuth secrets and tokens kept outside the npm package
- no runtime npm dependencies
- no environment-variable or filesystem access in node runtime behavior
- HTTPS trigger delivery to a registered public destination; the current
  capability-URL model and absence of a separate delivery signature are
  disclosed as a limitation
- public-repository and tarball scans for credentials, private URLs, customer
  data, generated files, and history
- protected tag release through npm Trusted Publishing/OIDC with provenance
- saved-workflow compatibility and package-content validation
- private vulnerability reporting through `info@sallaflow.cloud`

Replace this list with evidence links where the live form permits them.

## Reviewer test instructions

Provide n8n with an authorized synthetic test-store account and integration key
through its approved private channel. Do not commit test credentials.

1. Use a clean supported self-hosted n8n environment.
2. Install exact npm version `n8n-nodes-sallaflow@0.6.3`.
3. Add **SallaFlow** and **SallaFlow Trigger** from the node picker.
4. Create **SallaFlow API** credentials and run the credential test.
5. Run **Product → Get Many** with **Return All** off and **Limit** `10`.
6. Demonstrate another common read, such as **Order → Get Many**.
7. Activate an `order.created` Trigger using a public HTTPS webhook URL and
   generate a synthetic test-store event.
8. Confirm the Trigger receives the event, then deactivate it.
9. Add the SallaFlow app node as an AI tool to an AI Agent workflow and invoke
   one safe read action.
10. Import both sanitized example workflows from `examples/`.

No customer or production merchant data is needed.

## Manual-review video script

The current official process asks for a single uncut video of no more than five
minutes. Use this final recording checklist:

1. `0:00–0:35` — show a clean compatible n8n workspace and installed registry
   version `n8n-nodes-sallaflow@0.6.3`.
2. `0:35–1:05` — show **SallaFlow** and **SallaFlow Trigger** in the node
   picker.
3. `1:05–1:35` — create or select **SallaFlow API** credentials and run the
   successful credential test with the key fully obscured.
4. `1:35–2:20` — run **Product → Get Many** with a small limit and show only
   synthetic demo-store output.
5. `2:20–3:35` — activate one safe Trigger, generate one reversible synthetic
   event, confirm one delivery, then deactivate it.
6. `3:35–4:30` — attach the SallaFlow Action to an AI Agent as a tool and run
   one safe read request.
7. `4:30–5:00` — show cleanup and the public package/documentation links.

Keep browser tabs, logs, webhook URLs, merchant identifiers, and payloads
sanitized. Upload or link the video only through the method requested by the
live Portal.

## Example workflows

- `examples/get-products.json`
- `examples/order-created-trigger.json`

The examples omit credentials and contain no merchant or customer data.

## Screenshots and brand assets

Prepare sanitized screenshots of:

- Community Nodes installation with the exact package/version
- the Action and Trigger in the node picker
- successful credential test with the key obscured
- Product Get Many configuration and synthetic output
- `order.created` Trigger configuration and synthetic event
- SallaFlow Action attached to an AI Agent as a tool

Node icons:

- `nodes/SallaFlow/icon.svg`
- `nodes/SallaFlowTrigger/icon.svg`

If the official-representative profile is completed after approval, provide a
square JPG, PNG, or SVG SallaFlow logo no larger than 5 MB and complete the
requested company, website, integration, category, and optional social fields.

## Compatibility and maintenance statement

SallaFlow intends to:

- maintain the public repository as the npm source of truth
- preserve saved workflows or provide an explicit migration
- test the public 0.5.2 workflow baseline and migrate the current hosted
  deployment fixture from its `CUSTOM.*` namespace before import
- validate against the current supported n8n release before each publication
- use patch releases for focused reviewer fixes
- monitor n8n, npm, and Salla requirements and respond to security reports

Action v5 and Trigger v2 are retained for 0.6.3. The legacy
`shipment.return.creating` alias is preserved.

Workflows exported from the hosted private deployment use
`CUSTOM.sallaFlow`/`CUSTOM.sallaFlowTrigger`, while npm installs use
`n8n-nodes-sallaflow.sallaFlow`/`n8n-nodes-sallaflow.sallaFlowTrigger`.
Reviewers should use
`npm run workflow:migrate-namespace -- <input> <output>` for those hosted
exports. The tool changes only those exact node-type identifiers and is
excluded from the published runtime package.

## Submission gates

Before the owner approves final submission, verify:

- the public repository URL resolves to the scanned release commit
- npm 0.6.3 is published from the protected workflow
- npm shows provenance for that exact package version
- the registry tarball passed clean-install and compatibility tests
- the current stable official community-package scanner passes the submitted
  registry version
- the limited authenticated demo and cleanup are complete
- all placeholders in this document have been replaced with evidence
- screenshots and video contain no secrets or merchant/customer data
- the applicant is authorized to represent SallaFlow
- the one-time npm ownership code can be received

Final Creator Portal submission requires separate explicit owner approval.
