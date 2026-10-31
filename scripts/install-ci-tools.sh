#!/usr/bin/env bash
# Native CI acceptance tools: avoid compiling the development Nix shell on cold hosts.
set -euo pipefail
test "$PWD" = "$(git rev-parse --show-toplevel)"
test "$(uname -s)" = Linux
case "$(uname -m)" in
  x86_64)
    arch=amd64
    checksum=c515625487e009b0ee5613d67dc9bde2e16b21b1fc2179cfc523bd5a9224e292
    ;;
  aarch64)
    arch=arm64
    checksum=38c06b69faae51c3c06b5973c3fd63204edb05d25df358e786c1b267987524c6
    ;;
  *) echo 'Unsupported native acceptance architecture' >&2; exit 1 ;;
esac
# Digests match the pinned flake's nhost-cli distribution, not an unpinned latest.
work=$(mktemp -d "${RUNNER_TEMP:?RUNNER_TEMP must name an OS temporary directory}/retro-cli.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
curl --fail --silent --show-error --location --max-time 120 \
  "https://github.com/nhost/nhost/releases/download/cli%401.51.2/cli-1.51.2-linux-${arch}.tar.gz" \
  --output "$work/cli.tar.gz"
printf '%s  %s\n' "$checksum" "$work/cli.tar.gz" | sha256sum --check --status
tar -xzf "$work/cli.tar.gz" -C "$work" cli
mkdir -p "$RUNNER_TEMP/retro-bin"
install -m 0755 "$work/cli" "$RUNNER_TEMP/retro-bin/nhost"
"$RUNNER_TEMP/retro-bin/nhost" --version
if test -n "${GITHUB_PATH:-}"; then printf '%s\n' "$RUNNER_TEMP/retro-bin" >> "$GITHUB_PATH"; fi
