#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_JS="${SCRIPT_DIR%/scripts}/index.js"

TYPORA_RES_DEFAULT="/usr/share/typora/resources"
TYPORA_RES="${TYPORA_RES:-$TYPORA_RES_DEFAULT}"
PLUGIN_ROOT="$TYPORA_RES/plugin"
PLUGIN_FILE="$PLUGIN_ROOT/claude_terminal.js"
SETTINGS_FILE="$PLUGIN_ROOT/global/settings/settings.user.toml"

if [[ ! -f "$SRC_JS" ]]; then
  echo "[ERROR] Source js missing: $SRC_JS"
  exit 1
fi
if [[ ! -d "$PLUGIN_ROOT" ]]; then
  echo "[ERROR] Typora plugin root missing: $PLUGIN_ROOT"
  exit 1
fi
if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo "[ERROR] settings.user.toml missing: $SETTINGS_FILE"
  exit 1
fi

backup_ts="$(date +%Y%m%d-%H%M%S)"
cp -f "$SETTINGS_FILE" "${SETTINGS_FILE}.bak.${backup_ts}"
[[ -f "$PLUGIN_FILE" ]] && cp -f "$PLUGIN_FILE" "${PLUGIN_FILE}.bak.${backup_ts}"

{
  cat <<'JS_HEAD'
class ClaudeTerminalPlugin extends BasePlugin {
    process = () => {
        if (window.__typoraClaudeTerminalLoaded) return
JS_HEAD
  sed 's/^/        /' "$SRC_JS"
  cat <<'JS_TAIL'
    }
}

module.exports = {
    plugin: ClaudeTerminalPlugin
}
JS_TAIL
} > "$PLUGIN_FILE"

if ! grep -q '^\[claude_terminal\]' "$SETTINGS_FILE"; then
  {
    printf "\n[claude_terminal]\n"
    printf "NAME = \"Claude Terminal\"\n"
    printf "ENABLE = true\n"
  } >> "$SETTINGS_FILE"
fi

TMP="${SETTINGS_FILE}.tmp.$$"
awk '
BEGIN { section=""; in_ct=0; seen_enable=0; seen_name=0 }
/^\[/ {
  section=$0
  in_ct=(section=="[claude_terminal]")
  if (!in_ct) {
    seen_enable=0
    seen_name=0
  }
  print
  next
}
{
  if (in_ct) {
    if ($0 ~ /^[[:space:]]*ENABLE[[:space:]]*=/) {
      if (seen_enable) next
      seen_enable=1
      print "ENABLE = true"
      next
    }
    if ($0 ~ /^[[:space:]]*NAME[[:space:]]*=/) {
      if (seen_name) next
      seen_name=1
      print
      next
    }
  }
  print
}
END {
  if (section=="[claude_terminal]") {
    if (!seen_name) print "NAME = \"Claude Terminal\""
    if (!seen_enable) print "ENABLE = true"
  }
}
' "$SETTINGS_FILE" > "$TMP"
mv "$TMP" "$SETTINGS_FILE"

echo "[OK] Installed plugin file: $PLUGIN_FILE"
echo "[OK] Updated settings: $SETTINGS_FILE"
