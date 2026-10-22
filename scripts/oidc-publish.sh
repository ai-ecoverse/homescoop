#!/usr/bin/env bash
# npm publish over OIDC (trusted publishing), from ladder-build.yml's publish job.
#
#   bash scripts/oidc-publish.sh <package.tgz> <npm name> <dist-tag> <certified sha256>
#
# HOMESCOOP_NPM_LOGLEVEL (the dispatch input npm_loglevel) traces the publish:
# http or verbose sets NPM_CONFIG_LOGLEVEL, timing sets NPM_CONFIG_LOGLEVEL=http
# plus NPM_CONFIG_TIMING=true (npm 11 has no timing log level); anything else
# fails before npm runs. The verdict line is scripts/npm-publish.mjs's.
set -euo pipefail
TGZ=$1
NPM=$2
TAG=$3
CERTIFIED=$4
case "${HOMESCOOP_NPM_LOGLEVEL:-}" in
  '') ;;
  http|verbose) export NPM_CONFIG_LOGLEVEL="$HOMESCOOP_NPM_LOGLEVEL" ;;
  timing) export NPM_CONFIG_LOGLEVEL=http NPM_CONFIG_TIMING=true ;;
  *) echo "::error::npm_loglevel must be empty, http, timing or verbose" >&2; exit 2 ;;
esac
unset HOMESCOOP_NPM_LOGLEVEL
unset NODE_AUTH_TOKEN NPM_TOKEN NPM_CONFIG_TOKEN || true
ls -la "$TGZ"
node -v
npm -v
if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]]; then
  echo "ACTIONS_ID_TOKEN_REQUEST_URL unset — OIDC will not work" >&2
  exit 1
fi
# setup-node / a global npm install can leave _authToken= which short-circuits trusted publishing.
for npmrc in "${NPM_CONFIG_USERCONFIG:-}" "$HOME/.npmrc"; do
  [[ -n "$npmrc" && -f "$npmrc" ]] || continue
  echo "== strip _authToken from $npmrc"
  sed -i.bak '/_authToken/d' "$npmrc" || true
  cat "$npmrc" || true
done
node "$(dirname "$0")/gate.mjs" publish -- node "$(dirname "$0")/npm-publish.mjs" "$TGZ" --npm "$NPM" --tag "$TAG" --certified "$CERTIFIED"
