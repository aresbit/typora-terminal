#!/usr/bin/env bash
set -euo pipefail

FILE="/usr/share/typora/resources/plugin/global/settings/settings.user.toml"
TMP="/tmp/settings.user.toml.fixed.$$"

if [[ ! -f "$FILE" ]]; then
  echo "[ERROR] missing $FILE"
  exit 1
fi

cp -f "$FILE" "${FILE}.bak.$(date +%Y%m%d-%H%M%S)"

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
  if (!seen_enable && section=="[claude_terminal]") print "ENABLE = true"
}
' "$FILE" > "$TMP"

mv "$TMP" "$FILE"

echo "[OK] fixed: $FILE"
