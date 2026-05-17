#!/bin/sh
# Install or update the patched Vercel CLI on macOS/Linux:
#   curl -fsSL https://github.com/pc-style/vercel/releases/latest/download/install_patched.sh | sh
#
# Optional overrides:
#   INSTALL_DIR=/usr/local/bin BIN_NAME=vercel curl -fsSL https://github.com/pc-style/vercel/releases/latest/download/install_patched.sh | sh
#   VERCEL_PATCHED_RELEASE=vercel@54.1.0 curl -fsSL https://github.com/pc-style/vercel/releases/latest/download/install_patched.sh | sh

set -eu

REPO="${VERCEL_PATCHED_REPO:-pc-style/vercel}"
RELEASE="${VERCEL_PATCHED_RELEASE:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="${BIN_NAME:-vercel-patched}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command \"$1\" not found" >&2
    exit 1
  fi
}

need curl
need uname

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    platform="darwin"
    ;;
  Linux)
    platform="linux"
    ;;
  *)
    echo "error: unsupported operating system \"$os\"" >&2
    exit 1
    ;;
esac

case "$arch" in
  arm64 | aarch64)
    cpu="arm64"
    ;;
  x86_64 | amd64)
    cpu="x64"
    ;;
  *)
    echo "error: unsupported CPU architecture \"$arch\"" >&2
    exit 1
    ;;
esac

asset="vercel-${platform}-${cpu}"
base_url="https://github.com/${REPO}/releases"
if [ "$RELEASE" = "latest" ]; then
  download_url="${base_url}/latest/download/${asset}"
else
  download_url="${base_url}/download/${RELEASE}/${asset}"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

bin_path="${tmp_dir}/${asset}"
checksum_path="${tmp_dir}/${asset}.sha256"

echo "downloading ${asset} from ${REPO} (${RELEASE})"
curl -fsSL "$download_url" -o "$bin_path"
curl -fsSL "${download_url}.sha256" -o "$checksum_path"

expected="$(awk '{print $1}' "$checksum_path")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$bin_path" | awk '{print $1}')"
else
  need shasum
  actual="$(shasum -a 256 "$bin_path" | awk '{print $1}')"
fi

if [ "$actual" != "$expected" ]; then
  echo "error: checksum mismatch for ${asset}" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

chmod +x "$bin_path"
mkdir -p "$INSTALL_DIR"
mv "$bin_path" "${INSTALL_DIR}/${BIN_NAME}"

echo "installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"
"${INSTALL_DIR}/${BIN_NAME}" --version

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo "warning: ${INSTALL_DIR} is not in PATH" >&2
    echo "add this to your shell profile:" >&2
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" >&2
    ;;
esac
