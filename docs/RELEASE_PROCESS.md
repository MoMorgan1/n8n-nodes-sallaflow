# Release Process

This process keeps the public node reproducible without publishing the private
SallaFlow backend or maintaining two uncontrolled writable copies.

## Source-of-truth model

The public `MoMorgan1/n8n-nodes-sallaflow` repository is the canonical source
for node code, tests, public contracts, documentation, and npm releases.

The private SallaFlow repository remains canonical only for the backend,
infrastructure, and private operational material. A backend change can propose
a public-node change through an ordinary reviewed patch, but release work is
merged and tagged in the public repository. A drift check compares approved
public node files or contracts without copying either repository's history.

This separation provides one writable source for the npm package, a clean
public history, and a practical compatibility boundary without submodules or
cross-repository release automation.

## Release rules

- Use Semantic Versioning.
- Never reuse an npm version for different bytes.
- Do not publish an artifact from an unmerged or unapproved branch.
- Do not publish on an ordinary push or merge.
- Use a protected `vX.Y.Z` tag that points to the reviewed release commit.
- Build from a clean checkout with the pinned Node/npm toolchain.
- Publish with npm Trusted Publishing and provenance, not a long-lived npm
  token.
- npm publication and final n8n Creator Portal submission each require
  explicit owner approval.

## Prepare the candidate

1. Confirm that the approved node source and backend API contract are
   compatible.
2. Confirm the current npm registry version and select the next unused version.
3. Update package metadata and `CHANGELOG.md`; keep the entry **Unreleased**
   until publication succeeds.
4. Run the full validation:

   ```bash
   npm ci
   npm run validate
   npm run test:saved-workflows
   ```

5. Build and pack from a clean checkout.
6. Inspect every tarball path against the package allowlist.
7. Scan the worktree, proposed public history, built files, source maps,
   fixtures, and tarball for credentials, private URLs, merchant data, and
   operational material.
8. Pack twice from the same clean commit and compare SHA-256 checksums.
9. Install the tarball in a fresh supported self-hosted n8n environment.
10. Confirm Action and Trigger discovery, credential loading, catalogue
    counts, saved-workflow imports, and authorized read-only backend
    compatibility.

Example checksum command:

```bash
sha256sum n8n-nodes-sallaflow-0.6.3.tgz
```

Record the commit, toolchain versions, validation result, tarball path,
checksum, and installation result in the release evidence.

## npm Trusted Publisher setup

An npm package owner must configure the package's **Trusted Publisher** with:

- Provider: GitHub Actions
- GitHub owner: `MoMorgan1`
- Repository: `n8n-nodes-sallaflow`
- Workflow filename: the exact checked-in tag-release workflow filename
- GitHub environment: the exact protected environment name, if the workflow
  uses one

The release job must run on a GitHub-hosted runner and grant only the
permissions it needs, including:

```yaml
permissions:
  contents: read
  id-token: write
```

It must use a current npm CLI that supports Trusted Publishing and execute the
equivalent of:

```bash
npm publish --access public --provenance
```

Do not add `NODE_AUTH_TOKEN` or an npm automation token when OIDC is
configured. Protect the release environment and semantic-version tags with
required review.

Official references:

- [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/reference/security/oidc)

## Publish

After the owner explicitly approves npm publication:

1. Confirm the release commit is on the protected default branch.
2. Create and push the protected semantic-version tag.
3. Approve the protected GitHub environment, if configured.
4. Let the tag workflow rebuild, revalidate, pack, and publish.
5. Record the workflow URL, npm provenance evidence, and tarball checksum.
6. Create release notes from the final changelog.

Do not move or recreate a published tag.

## Post-publication verification

Use the exact registry version, not the local tarball:

```bash
npm view n8n-nodes-sallaflow@0.6.3
npm pack n8n-nodes-sallaflow@0.6.3
```

Install it into a fresh supported n8n environment and repeat discovery,
credential, catalogue, workflow-import, and read-only compatibility tests.
Compare the registry tarball checksum and contents with the recorded release
evidence.

Only after these checks pass should the changelog entry be finalized and the
n8n verification application be considered ready for its separate approval
gate.

## Reviewer feedback

Handle n8n reviewer feedback with focused pull requests. Use a new patch
version for any package change after publication; never replace published
bytes under the old version. Link each change to the reviewer request, rerun
the release process, and update the Creator Portal evidence.
