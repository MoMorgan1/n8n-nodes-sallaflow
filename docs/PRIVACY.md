# SallaFlow n8n Node Privacy Notice

Last reviewed: 2026-07-30

This notice describes the data flow of the public
`n8n-nodes-sallaflow` package. It supplements the
[SallaFlow Privacy Policy](https://sallaflow.cloud/privacy.html), which governs
the SallaFlow service. It does not replace the privacy terms that apply to the
user's n8n instance or Salla account.

## Parties and systems

The integration involves three systems:

- the user's n8n instance, operated by the user or their n8n provider
- the SallaFlow backend at `https://api.sallaflow.cloud`
- Salla's platform and Merchant API

For a self-hosted installation of this package, the operator of the n8n
instance controls workflow definitions, credentials, users, execution
history, and retention settings. Any separately advertised hosting service
has its own applicable privacy terms.

## Action data flow

When an Action runs:

1. n8n sends the selected operation, parameters, and SallaFlow integration key
   to the SallaFlow API over HTTPS.
2. SallaFlow identifies the connected merchant, checks authorization and
   applicable quota, and uses OAuth credentials managed by SallaFlow to call
   the Salla Merchant API.
3. SallaFlow returns the result or a normalized error to n8n.
4. n8n handles and may store the result according to the workflow and the
   instance's execution-data settings.

Depending on the operation, the request or response can contain store data such
as orders, products, inventory, customers, coupons, categories, brands,
feedback, or abandoned carts.

For supported product-image and brand-logo operations, SallaFlow can retrieve
content from the remote URL supplied by the user and upload it to Salla.

## Trigger data flow

When a Trigger workflow is activated, n8n sends the selected event value and
its production webhook destination to SallaFlow. SallaFlow stores the
subscription information needed to deliver that event.

When Salla sends a matching event, SallaFlow forwards the event payload over
HTTPS to the registered n8n webhook. n8n then processes and may retain that
payload according to the workflow and the instance's execution-data settings.
Deactivating the workflow asks SallaFlow to remove the registration.

## Data sent to SallaFlow

The node can send:

- the SallaFlow integration key
- selected resource, operation, event, filters, and field values
- Salla record identifiers supplied by the workflow
- data being created or updated in Salla
- the production webhook URL and event selection for active triggers
- remote image or logo URLs for supported upload operations
- opaque request-correlation information used for quota, retry, and diagnostic
  handling

The package does not include an analytics SDK. This does not mean that the
external service or the user's n8n instance keeps no operational logs; their
applicable policies and configuration govern that processing.

## Credentials

The n8n credential stores a SallaFlow integration key and sends it in the
`X-SallaFlow-Key` HTTPS request header only to the fixed SallaFlow API origin.
The package does not receive or store Salla OAuth client secrets or access
tokens. SallaFlow manages those tokens in its backend.

n8n encrypts stored credentials according to the configuration and security of
the user's n8n instance. Exported workflows should not contain credential
values, but users must still inspect exports and support bundles before sharing
them.

## Retention and deletion

Execution-data retention in n8n is controlled by the n8n operator. SallaFlow
service retention and account-deletion handling are governed by the
[SallaFlow Privacy Policy](https://sallaflow.cloud/privacy.html).

To stop future integration processing:

1. deactivate SallaFlow Trigger workflows
2. delete the SallaFlow credential from n8n
3. revoke or rotate the integration key in the SallaFlow merchant dashboard
4. uninstall the community-node package if it is no longer needed

Deleting an n8n credential does not by itself remove prior n8n execution data
or revoke the key in SallaFlow.

## Data minimization

Configure workflows to request and retain only the fields they need. Avoid
placing customer data, credentials, full webhook URLs, or complete production
responses in issue reports, screenshots, fixtures, or public logs.

## Contact

Questions about the SallaFlow service or this node's data flow can be sent to
[info@sallaflow.cloud](mailto:info@sallaflow.cloud).
