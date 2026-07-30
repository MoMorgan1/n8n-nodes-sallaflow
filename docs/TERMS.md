# SallaFlow n8n Node Terms

Last reviewed: 2026-07-30

This document explains which terms apply when using
`n8n-nodes-sallaflow`. It is a project summary, not a replacement for the
applicable legal agreements.

## Community-node software

The source code and npm package are provided under the repository's
[MIT License](../LICENSE). The package is an n8n community node. It is not
built into n8n core and must not be represented as verified, official, or
available on n8n Cloud unless n8n separately approves it.

## SallaFlow service

Using the node requires a SallaFlow account, a connected Salla store, and a
SallaFlow integration key. Use of the external SallaFlow backend is governed
by the current [SallaFlow Terms](https://sallaflow.cloud/terms.html) and
[Privacy Policy](https://sallaflow.cloud/privacy.html).

The service can enforce plan entitlements, monthly quotas, burst rate limits,
and supported-operation restrictions independently of the npm package
version. This package does not provision or include an n8n instance. Any
separately advertised hosting service is outside this package and governed by
its own current plan terms.

## Other platforms

The user's n8n instance and Salla account remain subject to their respective
providers' terms and policies. SallaFlow's community node does not change
those relationships and does not imply endorsement by n8n or Salla.

## User responsibilities

Users are responsible for:

- having authority to connect and automate the selected Salla store
- protecting the SallaFlow integration key and access to n8n
- ensuring workflows process merchant and customer data lawfully
- reviewing actions before enabling workflows that create, update, or delete
  Salla data
- configuring a secure public webhook URL for triggers
- maintaining backups and testing upgrades in an appropriate environment
- complying with applicable Salla, n8n, and SallaFlow terms

## Availability and changes

The package depends on the SallaFlow service, Salla APIs, network access, and
the user's n8n instance. Features can be affected by upstream API changes,
permissions, quotas, maintenance, or outages. Warranties and liability are
limited as stated in the governing terms and the MIT License.

## Contact

Questions can be sent to
[info@sallaflow.cloud](mailto:info@sallaflow.cloud).
