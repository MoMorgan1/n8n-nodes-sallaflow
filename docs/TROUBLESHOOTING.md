# Troubleshooting

Use this guide for common installation, credential, Action, and Trigger
problems.

## The package will not install

Check:

- The package name is exactly `n8n-nodes-sallaflow`.
- The n8n workspace is compatible and allows npm Community Nodes installation.
- You are signed in as an n8n Owner or Admin.
- The host can reach the npm registry.
- The n8n deployment's supported Node.js version satisfies this package's
  requirement.
- Disk permissions allow n8n to install community-node files.

After a manual or container installation, restart every n8n process that loads
community nodes. In queue mode, make sure the package is consistently present
where the main process and workers load community nodes.

The package is not currently approved for installation on n8n Cloud.

## The nodes do not appear

1. Confirm the package is listed under **Settings → Community Nodes**.
2. Confirm the installed package version.
3. Restart n8n.
4. Review n8n startup logs for a package-load or Node.js compatibility error.
5. Remove any separately installed local/custom build of the same node before
   troubleshooting the public npm installation.

Do not run two different artifacts with the same package or node identifier in
one n8n instance.

## An imported hosted workflow says the SallaFlow node is not installed

n8n includes the loader namespace in a saved workflow's node `type`. A
custom-extension installation registers `CUSTOM.sallaFlow` and
`CUSTOM.sallaFlowTrigger`, while the public npm package registers
`n8n-nodes-sallaflow.sallaFlow` and
`n8n-nodes-sallaflow.sallaFlowTrigger`. n8n does not automatically alias those
namespaces.

Public npm 0.5.2 workflows already use the package-qualified types. For a
workflow exported from a hosted/custom installation, use a checkout of this
repository to create a separate migrated file:

```bash
npm run workflow:check-namespace -- hosted-export.json
npm run workflow:migrate-namespace -- hosted-export.json npm-import.json
npm run workflow:check-namespace -- npm-import.json
```

The initial check exits unsuccessfully when either exact `CUSTOM.*` SallaFlow
type is present. The helper changes only those two workflow-node type values
and refuses to overwrite either source or existing output. Review the diff,
then import `npm-import.json` into an instance with the public package
installed. Create or reselect the destination SallaFlow API credential before
testing; a preserved credential reference does not transfer the secret.

Keep triggers inactive until the destination public HTTPS webhook URL is
correct. Do not load the custom build and npm package together as a migration
workaround.

## Credential test returns 401

A `401` normally means the integration key is missing, malformed, revoked, or
not recognized.

- Copy the key again from **SallaFlow Merchant Dashboard → Store & Plan →
  Credentials**.
- Remove leading or trailing whitespace.
- Confirm the key belongs to the intended merchant.
- Replace the credential if the key was rotated.
- Do not use a Salla OAuth access token in the SallaFlow credential.

## Credential or Action returns 403

A `403` can indicate that the integration key is valid but the merchant,
SallaFlow plan, Salla app connection, or upstream Salla permissions do not
allow the request. Confirm the store connection and operation entitlement in
SallaFlow.

## A request returns 429

The merchant may have reached a monthly read, write, or event quota, or a
short-period rate limit. Review the current SallaFlow entitlement and retry
after the indicated interval when appropriate.

Do not blindly retry writes after a timeout or ambiguous response. First check
whether Salla accepted the write.

## A dynamic selector does not show a record

Dynamic selectors load up to the latest 180 records. Use an n8n expression
containing the exact Salla record ID when an older record is not listed.
Confirm that the selected store and resource type are correct.

## A Trigger will not activate

Activation requires:

- a valid SallaFlow credential
- a public HTTPS production webhook URL
- correct n8n reverse-proxy and webhook URL configuration
- network access from SallaFlow to the n8n webhook

Do not use `localhost`, a private IP address, or an n8n test-webhook URL for an
active production trigger. Correct the public webhook configuration, restart
n8n if required, then deactivate and reactivate the workflow to refresh its
registration.

## A Trigger is active but no events arrive

1. Confirm the workflow is active, not only listening for a test event.
2. Confirm the expected canonical event value.
3. Confirm the event occurred in the same Salla store represented by the
   credential.
4. Check n8n webhook, reverse-proxy, firewall, and execution logs.
5. Confirm the SallaFlow event quota has not been reached.
6. Reactivate the trigger after correcting a changed public webhook URL.

Webhook delivery can be repeated after a transient delivery failure. Design
downstream workflows to be idempotent using the event or business-record
identifier where available.

The Trigger currently relies on the complete production webhook URL as a
capability URL and does not validate a separate SallaFlow delivery signature.
Keep the URL private. Before a payload initiates a payment, fulfillment,
deletion, or other high-impact action, verify the relevant record state through
an authenticated Action where practical.

The deprecated `shipment.return.creating` selection is treated as an alias of
`order.shipment.return.creating`.

## Image or logo upload fails

- Use a publicly reachable HTTPS image URL.
- Confirm the remote server allows the SallaFlow backend to retrieve it.
- Confirm the content is a valid image format and within Salla's current
  limits.
- Avoid short-lived signed URLs that expire before the workflow runs.
- Never use an internal URL that exposes private network services.

## Return All is slow or reaches a quota

Return All can request multiple pages, and each page can count as a read.
Prefer a bounded page and filters when the workflow does not need the complete
dataset. Feedback queries can fan out by selected feedback type.

## A saved workflow changed after an upgrade

Back up the workflow, confirm the old and new package versions, and compare the
node's stored parameters. Version 0.6.3 preserves Action v5,
Trigger v2, and the legacy trigger alias. Run the workflow in a non-production
instance before changing production.

If the editor reports an uninstalled node after moving from a hosted/custom
environment, follow the namespace migration above. CLI import success alone is
not proof that a saved node type resolves.

If reporting a compatibility issue, send a minimal workflow export with
credentials removed and values replaced by synthetic identifiers.

## Uninstall or revoke access

1. Deactivate trigger workflows.
2. Remove dependent workflow nodes.
3. Delete the SallaFlow API credential from n8n.
4. Revoke or rotate the integration key in SallaFlow.
5. Uninstall `n8n-nodes-sallaflow` from **Settings → Community Nodes**.

Removing the npm package or n8n credential does not itself revoke an
integration key.

## Requesting support

Email [info@sallaflow.cloud](mailto:info@sallaflow.cloud) with:

- n8n version and deployment type
- Node.js version
- installed `n8n-nodes-sallaflow` version
- node, resource, and operation or event
- HTTP status and sanitized error text
- minimal reproduction steps

Never send the integration key, OAuth tokens, customer data, merchant IDs,
complete webhook URLs, or raw production payloads.
