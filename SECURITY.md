# Security Policy

## Reporting a vulnerability

Report a suspected vulnerability privately to
[info@sallaflow.cloud](mailto:info@sallaflow.cloud) with the subject
`SECURITY: n8n-nodes-sallaflow`.

Include, when safe:

- the affected package version
- the affected node and operation
- a minimal reproduction using synthetic data
- the security impact
- suggested remediation, if known

Do not open a public issue for an undisclosed vulnerability. Do not send
integration keys, Salla OAuth tokens, customer data, full webhook URLs, or raw
production responses. If a secret was exposed while testing, rotate it before
reporting.

SallaFlow will acknowledge the report, investigate it, and coordinate
disclosure and a release as appropriate. Response and remediation timing
depends on severity, reproducibility, and any necessary coordination with n8n
or Salla.

## Supported versions

The current npm release receives routine security fixes. The public repository
may contain an unreleased next version; repository code is not a supported
release merely because it is visible.

For the installed version, run:

```bash
npm view n8n-nodes-sallaflow version
```

Then compare it with the version recorded by the n8n community-node
installation.

## Security boundaries

The node:

- sends the SallaFlow integration key only to the fixed SallaFlow API origin
  over HTTPS
- relies on SallaFlow to manage Salla OAuth tokens and Merchant API access
- relies on the user's n8n instance to encrypt stored credentials
- registers trigger webhook destinations with SallaFlow on workflow activation
- has no runtime npm dependencies in the current package manifest

The external SallaFlow service, the Salla platform, and the user's n8n instance
remain separate security boundaries. See [`docs/PRIVACY.md`](docs/PRIVACY.md)
for the data flow.

Trigger delivery currently relies on the registered, n8n-generated production
webhook URL as a capability URL. The Trigger does not validate a separate
SallaFlow delivery signature. Keep the complete webhook URL private, terminate
TLS correctly, restrict access to n8n, and validate event data before any
high-impact downstream action. This limitation must be disclosed during n8n's
security review.

Report vulnerabilities in n8n itself through n8n's published security process,
and vulnerabilities in Salla through Salla's published process.

## Safe operating practices

- Give the integration key only to the intended merchant's n8n credential.
- Restrict n8n access and keep n8n, Node.js, and this package updated.
- Use HTTPS and a correctly configured public webhook URL.
- Treat the complete production webhook URL as sensitive and never publish it
  in workflow examples, issue reports, logs, or screenshots.
- Validate event identifiers and current Salla record state before irreversible
  downstream actions when a Trigger payload is the initiating input.
- Exclude credentials and sensitive execution data from exported workflows.
- Deactivate triggers before deleting credentials or uninstalling the package.
- Rotate the SallaFlow integration key when a user leaves or access is
  suspected to be compromised.
