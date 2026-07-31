# 0.6.3 post-publication validation

Validated 2026-07-31 against the exact npm registry package.

## Publication evidence

- npm: `n8n-nodes-sallaflow@0.6.3`
- npm `latest`: `0.6.3`
- published: `2026-07-31T09:17:58.189Z`
- tag: `v0.6.3`
- release commit: `3c4e1b54f4a9cd7bc1166cc29493ed958e94986c`
- publish workflow:
  <https://github.com/MoMorgan1/n8n-nodes-sallaflow/actions/runs/30613237411>
- GitHub Release:
  <https://github.com/MoMorgan1/n8n-nodes-sallaflow/releases/tag/v0.6.3>
- npm provenance:
  <https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-sallaflow@0.6.3>
- tarball size: 70,457 bytes
- tarball SHA-256:
  `1931d9e345b162733d08951ce702a667ae5e14aa6003ab94c393323f86f54d4c`
- npm integrity:
  `sha512-F+Yl2OPpCyC7FZHJLHeInDsglw9U+R7kE4qb8XdKmN4soA/raEaF81EaLlShtGEX7FHfOfRUBDavsRyA1XN4aA==`

The reviewed release candidate, GitHub Release asset, and npm registry
tarball are byte-identical and contain exactly the 23 allowlisted files.

The SLSA provenance statement identifies:

- repository `https://github.com/MoMorgan1/n8n-nodes-sallaflow`
- workflow `.github/workflows/publish.yml`
- tag `refs/tags/v0.6.3`
- commit `3c4e1b54f4a9cd7bc1166cc29493ed958e94986c`
- workflow run `30613237411`, attempt 1
- GitHub-hosted builder
- protected GitHub environment `npm`
- Sigstore transparency-log index `2299963968`

## Fresh registry installations

Fresh disposable n8n 2.32.6 and 2.6.3 environments installed the exact
registry tarball with lifecycle scripts disabled, no credentials, and no
outbound runtime access. Both passed:

- SallaFlow API credential definition loaded with a required password-masked
  integration key and credential test
- Action v5 loaded with 11 resources and 46 public operations
- Trigger v2 loaded with 65 unique selectable choices
- the Action Tool node was generated
- no Trigger Tool node was generated
- the public 0.5.2 saved workflow imported unchanged and resolved
- the hosted 0.6.1 workflow imported and resolved after the documented two
  exact `CUSTOM.*` namespace replacements

The imported workflows remained inactive. No integration key, credential
entity, merchant, customer, or production data was used.

## Official scanner

The pinned official registry scanner
`@n8n/scan-community-package@0.30.0` passed all checks:

- npm provenance
- source retrieval from GitHub commit `3c4e1b5`
- registry package download
- source and compiled-package static analysis

The scanner remediation that blocked 0.6.2 is resolved in 0.6.3.

## Authenticated demonstration

No approved authenticated n8n session was available during this validation.
No integration key was extracted, no merchant was accessed, and no workflow,
subscription, counter, or synthetic store data was created.

Complete the credential test, Product Get Many, one Trigger lifecycle, one
normal Action, and one Action-as-AI-Tool execution in the approved demo
workspace before recording the final submission video.

## Submission status

Creator Portal submission has not been made. Publication, provenance,
official-scanner, package-integrity, fresh-install, catalogue, AI Tool, and
saved-workflow compatibility checks are complete. The authenticated demo,
sanitized screenshots, five-minute video, and separate owner approval remain
required before submission.
