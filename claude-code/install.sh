#!/usr/bin/env bash
# Installs the claude-flows skills, agents and CLIs as symlinks into this repo,
# or with --uninstall removes them. Never overwrites anything it did not create.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CLAUDE_HOME="$HOME/.claude"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

usage() {
  cat <<EOF
Usage: ./install.sh [--uninstall]

Symlinks this repo's skills and agents into ~/.claude and its two CLIs
(create-flow, build-flow) into $BIN_DIR.

  --uninstall   remove those symlinks (only ones pointing into this repo)
  -h, --help    show this help

Set BIN_DIR to put the CLIs somewhere other than ~/.local/bin.
EOF
}

MODE=install
case "${1:-}" in
  "") ;;
  --uninstall) MODE=uninstall ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

# Every link, as "source|destination".
LINKS=()
for skill in create-flow build-flow; do
  LINKS+=("$REPO/skills/$skill|$CLAUDE_HOME/skills/$skill")
  LINKS+=("$REPO/skills/$skill/flow.mjs|$BIN_DIR/$skill")
done
for agent in "$REPO"/agents/*.md; do
  LINKS+=("$agent|$CLAUDE_HOME/agents/$(basename "$agent")")
done

# True when $2 is already a symlink to $1.
linked() { [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ]; }

if [ "$MODE" = uninstall ]; then
  removed=0
  for link in "${LINKS[@]}"; do
    src="${link%%|*}"; dst="${link#*|}"
    if linked "$src" "$dst"; then
      rm "$dst"
      echo "removed  $dst"
      removed=$((removed + 1))
    fi
  done
  echo "Removed $removed link(s). Run folders and ~/.local/state/{create,build}-flow were left alone."
  exit 0
fi

# --- Preflight: check everything before touching anything. ---

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js 20.11 or newer." >&2
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 11) ? 0 : 1)'; then
  echo "error: Node.js $(node --version) is too old; 20.11 or newer is needed." >&2
  exit 1
fi
command -v git >/dev/null 2>&1 || echo "warning: git not found; build-flow needs it." >&2

if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ "$CLAUDE_CONFIG_DIR" != "$CLAUDE_HOME" ]; then
  echo "warning: CLAUDE_CONFIG_DIR is $CLAUDE_CONFIG_DIR, but the flows' hooks expect ~/.claude." >&2
fi

conflicts=0
for link in "${LINKS[@]}"; do
  src="${link%%|*}"; dst="${link#*|}"
  linked "$src" "$dst" && continue
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    echo "exists:  $dst" >&2
    conflicts=$((conflicts + 1))
  fi
done
if [ "$conflicts" -gt 0 ]; then
  echo "Nothing installed: move or remove the path(s) above, then run ./install.sh again." >&2
  exit 1
fi

# --- Install. ---

mkdir -p "$CLAUDE_HOME/skills" "$CLAUDE_HOME/agents" "$BIN_DIR"
chmod +x "$REPO"/skills/*/flow.mjs

for link in "${LINKS[@]}"; do
  src="${link%%|*}"; dst="${link#*|}"
  if linked "$src" "$dst"; then
    echo "ok       $dst"
  else
    ln -s "$src" "$dst"
    echo "linked   $dst"
  fi
done

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "warning: $BIN_DIR is not on your PATH; add it so create-flow and build-flow are found." >&2 ;;
esac

echo
echo "Installed. In Claude Code, start with /create-flow or /build-flow (see README.md)."
