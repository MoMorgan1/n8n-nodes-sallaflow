## Summary

Describe the user-facing change and why it is needed.

## Validation

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:coverage`
- [ ] `npm run test:saved-workflows`
- [ ] `npm run build:check`
- [ ] `npm run check:manifest`
- [ ] `npm run check:security`
- [ ] `npm run pack:check`

## Release and compatibility

- [ ] Action v5 and Trigger v2 compatibility is preserved, or the migration is documented.
- [ ] Existing public and hosted saved-workflow fixtures still import.
- [ ] Package metadata, README, and CHANGELOG are updated when relevant.
- [ ] Generated `dist` files match their TypeScript sources.
- [ ] This pull request does not publish to npm or claim n8n verification.

## Public-data boundary

- [ ] No backend source, operator runbooks, private infrastructure URLs, IP addresses, credentials, tokens, private keys, merchant/customer data, demo identifiers, or raw E2E payloads are included.
- [ ] New fixtures and examples use synthetic values or `.example` domains.
