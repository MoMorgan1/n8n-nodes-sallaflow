# 0.6.2 post-publication validation

Validated 2026-07-31 against the exact npm registry package.

## Publication evidence

- npm: `n8n-nodes-sallaflow@0.6.2`
- npm `latest`: `0.6.2`
- tag: `v0.6.2`
- release commit: `27874435cfea916e93a2ac7116cb4860366be9a3`
- publish workflow:
  <https://github.com/MoMorgan1/n8n-nodes-sallaflow/actions/runs/30607600157>
- GitHub Release:
  <https://github.com/MoMorgan1/n8n-nodes-sallaflow/releases/tag/v0.6.2>
- npm provenance:
  <https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-sallaflow@0.6.2>
- tarball size: 70,317 bytes
- tarball SHA-256:
  `263481bbb0e986b9e856dc737b1885cd9f4eb1ae64ae94a4b34fd30c11a515c4`

The reviewed release candidate, GitHub Release asset, and npm registry
tarball are byte-identical.

The SLSA provenance statement identifies:

- repository `https://github.com/MoMorgan1/n8n-nodes-sallaflow`
- workflow `.github/workflows/publish.yml`
- tag `refs/tags/v0.6.2`
- commit `27874435cfea916e93a2ac7116cb4860366be9a3`
- workflow run `30607600157`

## Fresh registry installations

Fresh disposable n8n 2.32.6 and 2.6.3 environments installed the package by
the exact registry coordinate, with no credentials and no outbound runtime
access. Both passed:

- SallaFlow API credential definition loaded
- Action v5 loaded with 11 resources and 46 public operations
- Trigger v2 loaded with 65 unique selectable choices
- the Action Tool node was generated
- no Trigger Tool node was generated
- the public 0.5.2 saved workflow imported and resolved
- the hosted 0.6.1 workflow imported and resolved after the documented two
  exact `CUSTOM.*` namespace replacements

## Official scanner

The official scanner passed provenance, source retrieval, download, and
analysis setup, but failed its ESLint gate:

| Scanner | Result |
| --- | --- |
| `@n8n/scan-community-package@0.29.1` (`stable`) | 32 errors |
| `@n8n/scan-community-package@0.30.0` (`latest`) | 34 errors |

The findings are display-order and `ID` capitalization rules, an explicit
Trigger `usableAsTool` declaration, and—on 0.30.0—two webhook lifecycle error
handling rules. This blocks Creator Portal submission of 0.6.2 as a clean
package. It does not invalidate the successful runtime-install checks.

## Authenticated demonstration

No approved authenticated n8n session was available during this validation.
No integration key was extracted, no merchant was accessed, and no workflow,
subscription, counter, or synthetic store data was created.

Complete the credential test, Product Get Many, one Trigger lifecycle, one
normal Action, and one Action-as-AI-Tool execution in the approved demo
workspace before recording the final submission video.

## Submission status

Creator Portal submission has not been made. Prepare a focused patch release
that passes the current official scanner, complete the authenticated demo and
five-minute video, then request separate explicit approval to submit.
