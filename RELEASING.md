# Releasing logsafe

Two independent packages: `logsafe` (packages/server) and `logsafe-client`
(packages/client). Versions bump independently.

1. Bump `version` in the package(s) you're releasing.
2. Full gate: `npm test && npm run typecheck && npm run build:ui`.
3. Pack-and-install smoke (must pass before any publish):

```bash
npm run build:ui
npm run build -w packages/server -w packages/client
npm pack -w packages/server -w packages/client --pack-destination /tmp
mkdir -p /tmp/ls-smoke && cd /tmp/ls-smoke && npm init -y >/dev/null
npm i /tmp/logsafe-*.tgz /tmp/logsafe-client-*.tgz
LOGSAFE_DB=/tmp/ls-smoke.db PORT=4600 npx logsafe &          # serves
sleep 1
curl -s localhost:4600/api/health                   # {"ok":true}
curl -s localhost:4600/ | grep -qi logsafe && echo UI-OK
node -e "import('logsafe-client').then(m => console.log(typeof m.initLogsafe))"  # function
npx logsafe --version
kill %1; cd /; rm -rf /tmp/ls-smoke /tmp/ls-smoke.db* /tmp/logsafe-*.tgz
```

4. MCP handshake check: configure a scratch MCP client (or
   `npx tsx packages/server/test/mcp.test.ts` equivalent — the integration
   test in CI-less form is `npx vitest run packages/server/test/mcp.test.ts`).
5. Publish (needs `npm login`): `npm publish -w packages/client` then
   `npm publish -w packages/server`.
6. Tag: `git tag logsafe-vX.Y.Z && git push origin --tags`.
