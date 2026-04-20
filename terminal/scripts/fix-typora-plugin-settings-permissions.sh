#!/usr/bin/env bash
set -euo pipefail

TARGETS=(
  "/usr/share/typora/resources/plugin/global/settings/settings.user.toml"
  "/usr/share/typora/resources/plugin/global/settings/custom_plugin.user.toml"
)

OWNER_USER="${SUDO_USER:-${USER:-}}"
if [[ -z "$OWNER_USER" ]]; then
  echo "[ERROR] Cannot determine target owner user"
  exit 1
fi

OWNER_GROUP="$(id -gn "$OWNER_USER")"

for f in "${TARGETS[@]}"; do
  if [[ -f "$f" ]]; then
    chown "$OWNER_USER:$OWNER_GROUP" "$f"
    chmod 664 "$f"
    echo "[OK] fixed permission: $f -> $OWNER_USER:$OWNER_GROUP 664"
  else
    echo "[WARN] skip missing file: $f"
  fi
done
