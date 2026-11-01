#!/bin/sh
set -eu

fail() {
  echo "$1" >&2
  exit 1
}

case "$FRONTEND_DOMAIN" in
  *.nhost.app) worker_name=${FRONTEND_DOMAIN%.nhost.app} ;;
  *) fail 'FRONTEND_DOMAIN must be <name>.nhost.app (no scheme or path).' ;;
esac
case "$worker_name" in
  ''|*[!a-z0-9-]*|-*|*-) fail 'FRONTEND_DOMAIN must contain one valid lowercase hostname label before .nhost.app.' ;;
esac
[ "${#worker_name}" -le 63 ] || fail 'Worker names must be at most 63 characters.'
[ -n "$CLOUDFLARE_DISPATCH_NAMESPACE" ] || fail 'CLOUDFLARE_DISPATCH_NAMESPACE cannot be empty.'

# Deployment must explicitly choose a cloud backend rather than inherit local defaults.
if [ -z "${VITE_NHOST_SUBDOMAIN:-}" ] || [ "${VITE_NHOST_SUBDOMAIN:-}" = local ] ||
   [ -z "${VITE_NHOST_REGION:-}" ] || [ "${VITE_NHOST_REGION:-}" = local ]; then
  case "${VITE_NHOST_AUTH_URL:-} ${VITE_NHOST_GRAPHQL_URL:-}" in
    https://*\ https://*) ;;
    *) fail 'Export non-local VITE_NHOST_SUBDOMAIN and VITE_NHOST_REGION, or both HTTPS VITE_NHOST_AUTH_URL and VITE_NHOST_GRAPHQL_URL, before deploying.' ;;
  esac
fi

command -v "$WRANGLER" >/dev/null 2>&1 || fail 'Wrangler is missing; run this target inside nix develop.'
pnpm --filter @retro/frontend build
"$WRANGLER" deploy --config frontend/wrangler.toml \
  --dispatch-namespace "$CLOUDFLARE_DISPATCH_NAMESPACE" \
  --name "$worker_name" "$@"
