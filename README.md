# n8n-nodes-sallaflow

<p align="center">
  <img src="./dist/nodes/SallaFlow/icon.svg" width="72" height="72" alt="SallaFlow">
</p>

[![npm version](https://img.shields.io/npm/v/n8n-nodes-sallaflow.svg)](https://www.npmjs.com/package/n8n-nodes-sallaflow)
[![license](https://img.shields.io/npm/l/n8n-nodes-sallaflow.svg)](LICENSE)

Connect a Salla store to n8n workflows with Merchant API actions and real-time
store-event triggers. SallaFlow manages the Salla OAuth connection, token
refresh, API proxying, quotas, and webhook delivery, so workflow credentials
contain a SallaFlow integration key rather than Salla OAuth tokens.

SallaFlow is an n8n community node. It is not built into n8n core, has not yet
been approved by n8n for n8n Cloud, and must not be described as verified or
official unless n8n grants that status.

[Website](https://sallaflow.cloud) ·
[npm package](https://www.npmjs.com/package/n8n-nodes-sallaflow) ·
[Salla app](https://apps.salla.sa/ar/app/525017169) ·
[Support](mailto:info@sallaflow.cloud)

> The source in this repository targets 0.6.2. The npm registry is the source
> of truth for released versions. If npm does not list 0.6.2, this repository
> version is still a release candidate and `npm install` will install the
> registry's current release.

## Requirements

- A compatible n8n workspace where npm Community Nodes installation is enabled
- Node.js 22.22.0 or newer for development and package validation
- A Salla store with an active SallaFlow account and app connection
- A SallaFlow integration key
- A publicly reachable HTTPS webhook URL for trigger workflows

This community-node package does not provision or include an n8n workspace or
subscription. Install it in a compatible workspace where npm Community Nodes
installation is enabled. Any separately advertised hosting service is outside
this package and governed by its own current plan terms.

The 0.6.2 release candidate is tested with n8n 2.32.6, which was the current
stable release when it was prepared, and with the existing hosted compatibility
target n8n 2.6.3. The package uses Action type version 5 and Trigger type
version 2 on both. n8n 2.6.3 is a migration test target, not a recommendation
to remain on an older n8n release.

## Installation

Sign in to a compatible n8n workspace as an Owner or Admin:

1. Open **Settings → Community Nodes → Install**.
2. Enter the exact npm package name:

   ```text
   n8n-nodes-sallaflow
   ```

3. Review n8n's community-package warning and select **Install**.
4. Confirm that **SallaFlow** and **SallaFlow Trigger** appear in the node
   picker.

See n8n's
[community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation/)
for supported Community Nodes installation methods.

The package is not currently available for installation on n8n Cloud. Cloud
availability depends on completion and approval of n8n's current verification
process.

## Credentials

1. Install the SallaFlow app for the store and finish the SallaFlow account
   connection.
2. In the SallaFlow merchant dashboard, open **Store & Plan → Credentials**.
3. Copy the integration key.
4. In n8n, create a **SallaFlow API** credential, paste the key, and run the
   credential test.

Treat the integration key as a password. Do not place it in workflow JSON,
screenshots, issue reports, or source control. Revoke or replace it if it is
exposed.

## First Action workflow

1. Create a workflow with **Manual Trigger**.
2. Add **SallaFlow**.
3. Select **Product → Get Many**.
4. Turn off **Return All** and set **Limit** to `10`.
5. Select the SallaFlow API credential and run the node.

A sanitized importable example is available in
[`examples/get-products.json`](examples/get-products.json). It intentionally
contains no credential reference.

## First Trigger workflow

1. Add **SallaFlow Trigger**.
2. Select `order.created`.
3. Select the SallaFlow API credential.
4. Add the action that should handle the event.
5. Save and activate the workflow.

Activation registers the production n8n webhook URL with SallaFlow.
Deactivation unregisters it. The n8n instance must advertise the correct
public HTTPS webhook URL through its normal reverse-proxy and webhook
configuration.

A sanitized example is available in
[`examples/order-created-trigger.json`](examples/order-created-trigger.json).

## Supported actions

Action type version 5 exposes 46 operations across 11 resources.

| Resource        | Operations                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- |
| Abandoned Cart  | Get, Get Many                                                                               |
| Order           | Get, Get Many, Create, Update Status, Cancel                                                |
| Product         | Get, Get Many, Create, Update, Delete, Attach Image, Update Quantity, Bulk Update Inventory |
| Product Option  | Create, Get, Get Many, Update, Update Value, Delete                                         |
| Product Variant | Get, Get Many, Update, Update Quantity                                                      |
| Customer        | Get, Get Many, Create, Update                                                               |
| Coupon          | Get, Get Many, Create, Update, Delete                                                       |
| Brand           | Get, Get Many, Create, Update, Delete                                                       |
| Category        | Get, Get Many, Create, Update, Delete                                                       |
| Feedback        | Get Many                                                                                    |
| Custom API Call | Make Request                                                                                |

Get Many operations support a bounded page and, where shown, **Return All**
pagination. Dynamic selectors load up to the latest 180 records; enter a
record ID with an expression when an older record is not in the list.

Remote product images and brand logos supplied to supported operations are
retrieved by the SallaFlow backend and uploaded to Salla.

## Supported trigger events

Trigger type version 2 exposes 64 canonical event values:

- Orders: `order.created`, `order.updated`, `order.status.updated`,
  `order.cancelled`, `order.refunded`, `order.deleted`,
  `order.products.updated`, `order.payment.updated`, `order.coupon.updated`,
  `order.total.price.updated`, `order.shipment.creating`,
  `order.shipment.created`, `order.shipment.cancelled`,
  `order.shipment.return.creating`, `order.shipment.return.created`,
  `order.shipment.return.cancelled`, `order.shipping.address.updated`
- Products: `product.created`, `product.updated`, `product.deleted`,
  `product.available`, `product.quantity.low`, `product.channels.changed`,
  `product.price.updated`, `product.status.updated`, `product.image.updated`,
  `product.category.updated`, `product.brand.updated`, `product.tags.updated`
- Customers: `customer.created`, `customer.updated`, `customer.login`,
  `customer.otp.request`
- Abandoned carts: `abandoned.cart`, `abandoned.cart.updated`,
  `abandoned.cart.status.changed`, `abandoned.cart.purchased`
- Coupons: `coupon.applied`, `coupon.created`, `coupon.updated`
- Shipments: `shipment.creating`, `shipment.created`, `shipment.cancelled`,
  `shipment.updated`
- Shipping configuration: `shipping.zone.created`, `shipping.zone.updated`,
  `shipping.company.created`, `shipping.company.updated`,
  `shipping.company.deleted`
- Catalogue and content: `category.created`, `category.updated`,
  `brand.created`, `brand.updated`, `brand.deleted`, `review.added`,
  `specialoffer.created`, `specialoffer.updated`
- Other store events: `invoice.created`, `store.branch.created`,
  `store.branch.updated`, `store.branch.setDefault`,
  `store.branch.activated`, `store.branch.deleted`, `storetax.created`

The deprecated `shipment.return.creating` value remains selectable as an alias
of `order.shipment.return.creating` so older saved workflows can continue to
load. This gives 65 selectable choices without introducing a 65th canonical
event.

## Data flow and security model

For an Action:

```text
n8n
  → SallaFlow API over HTTPS using the integration key
  → Salla Merchant API using OAuth managed by SallaFlow
  → SallaFlow API
  → n8n
```

For a Trigger:

```text
Salla
  → SallaFlow webhook service
  → the public HTTPS webhook URL registered by the n8n workflow
  → n8n
```

The node communicates with the SallaFlow backend at
`https://api.sallaflow.cloud`. The backend identifies the merchant represented
by the integration key, enforces the applicable quota, manages Salla OAuth
tokens, and performs the requested Salla Merchant API call or webhook
delivery. The node package does not contain Salla OAuth client secrets and has
no runtime npm dependencies.

SallaFlow may add opaque correlation identifiers to help associate a logical
request with retry, quota, and diagnostic handling. n8n stores credentials and
execution data according to the configuration of the user's n8n instance.
See the node-specific [privacy notice](docs/PRIVACY.md) and
[security policy](SECURITY.md).

## Quotas, retries, and error handling

SallaFlow plans can impose monthly event, read, and write quotas, as well as
short-period rate limits. Current entitlements are shown by the SallaFlow
service and may change independently of this package.

The backend can retry safe reads after eligible transient upstream failures.
It does not automatically retransmit a write after an ambiguous response.
Pagination pages, dynamic selector requests, and separate feedback queries can
each consume reads. Errors returned by SallaFlow or Salla are normalized for
n8n when possible.

## Versions and upgrades

- npm `latest` is the authority for the current public release.
- The repository version is not a public release until that exact artifact has
  been published to npm.
- Ordinary merges do not publish a package. Releases use protected semantic
  version tags and npm Trusted Publishing with provenance.
- n8n verification is a separate approval process and is not implied by an npm
  release.

### Saved workflow node types

n8n stores the loader namespace in every saved node `type`. Workflows created
with the public npm package, including public version 0.5.2, already use the
package-qualified types:

| Loader                 | Action type                     | Trigger type                           |
| ---------------------- | ------------------------------- | -------------------------------------- |
| Public npm package     | `n8n-nodes-sallaflow.sallaFlow` | `n8n-nodes-sallaflow.sallaFlowTrigger` |
| Local/custom extension | `CUSTOM.sallaFlow`              | `CUSTOM.sallaFlowTrigger`              |

An npm installation does not automatically resolve the two `CUSTOM.*` types.
If a workflow was exported from a SallaFlow-hosted or other custom-extension
environment, migrate the two exact node type values before importing it into
an n8n instance that has only the npm package installed.

From a checkout of this repository:

```bash
npm run workflow:check-namespace -- hosted-export.json
npm run workflow:migrate-namespace -- hosted-export.json npm-import.json
npm run workflow:check-namespace -- npm-import.json
```

The first check intentionally exits unsuccessfully when migration is needed.
The migration helper refuses to overwrite its input or an existing output. It
changes only exact `CUSTOM.sallaFlow` and `CUSTOM.sallaFlowTrigger` values in
workflow-node `type` fields; type versions, parameters, connections, and
credential references are preserved. It does not copy or create the referenced
credential on the destination n8n instance.

Sanitized inactive fixtures document both forms:

- [`examples/compatibility/public-npm-0.5.2.json`](examples/compatibility/public-npm-0.5.2.json)
- [`examples/compatibility/hosted-0.6.1-custom.json`](examples/compatibility/hosted-0.6.1-custom.json)

When upgrading from public version 0.5.2:

1. Export or back up important workflows and credentials using your normal n8n
   backup process.
2. Review [`CHANGELOG.md`](CHANGELOG.md).
3. Upgrade the package in a non-production n8n instance first.
4. Open saved workflows and confirm Action v5 and Trigger v2 settings.
5. Test credentials, one read action, and each active trigger before upgrading
   production.
6. Reactivate a trigger if its production webhook registration needs to be
   refreshed.

When moving a hosted/custom workflow to the npm package:

1. Deactivate its triggers in the source environment and export a backup.
2. Run the namespace migration above and review the resulting JSON diff.
3. Install only the public npm package in the destination environment.
4. Import the migrated workflow and create or reselect its SallaFlow API
   credential.
5. Test a read action and each trigger while the workflow is inactive, then
   activate it when the destination webhook URL is ready.

Do not load a custom SallaFlow build and the public npm package in the same n8n
instance during migration.

The compatibility alias described above is retained for older trigger
workflows. The release process also validates saved-workflow fixtures from
public 0.5.2 and hosted 0.6.1, including the required namespace migration,
before publication.

## Known limitations

- The package is a community node and is not currently installable on n8n
  Cloud.
- Every operation depends on the external SallaFlow service and the connected
  Salla store.
- Trigger delivery requires a publicly reachable n8n production webhook URL.
- Trigger delivery uses the complete production webhook URL as a capability
  URL and does not currently include a separately validated SallaFlow delivery
  signature; keep that URL private and validate data before high-impact work.
- Quotas and Salla API permissions can limit available operations.
- Dynamic selectors show the latest 180 records rather than the complete
  catalogue.
- The Custom API Call operation is for supported Salla Merchant API paths and
  still passes through SallaFlow's access and quota controls.
- This npm package does not provision or manage the user's n8n instance.

## Uninstall and credential revocation

Before uninstalling:

1. Deactivate SallaFlow Trigger workflows so their webhook registrations are
   removed.
2. Remove or disable workflows that depend on the nodes.
3. Delete the SallaFlow API credential from n8n.
4. Revoke or rotate the integration key in the SallaFlow merchant dashboard
   when access should end.
5. In **Settings → Community Nodes**, uninstall
   `n8n-nodes-sallaflow`, then restart n8n if prompted.

Deleting a credential from n8n does not by itself revoke the key in SallaFlow.

## Troubleshooting and support

See [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) for installation,
credential, quota, webhook, image, and upgrade help.

- Email: [info@sallaflow.cloud](mailto:info@sallaflow.cloud)
- Privacy policy: [sallaflow.cloud/privacy.html](https://sallaflow.cloud/privacy.html)
- Terms: [sallaflow.cloud/terms.html](https://sallaflow.cloud/terms.html)

Remove integration keys, OAuth tokens, customer data, merchant identifiers,
and complete webhook URLs from logs and screenshots before requesting support.

## Development

This public repository is the canonical source for the distributable node.
Backend implementation and operational infrastructure are maintained
separately. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md).

Current n8n requirements and the evidence still needed for verification are
tracked in [`docs/VERIFICATION_COMPLIANCE.md`](docs/VERIFICATION_COMPLIANCE.md).

## License

[MIT](LICENSE)
