#!/usr/bin/env bash
# One-shot: keep Tailscale CGNAT out of hide.me and prefer Regiuslabsys profile.
# Requires root (pkexec/sudo). Does not stop hide.me or other services.
set -euo pipefail

log() { printf '%s\n' "$*"; }

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  log "Need root. Re-run via: pkexec $0"
  exit 1
fi

OPERATOR="${SUDO_USER:-sushi}"
TS_CGNAT_V4='100.64.0.0/10'
TS_CGNAT_V6='fd7a:115c:a1e0::/48'
RULE_PREF_V4=5260
RULE_PREF_V6=5261

log "==> Allow user ${OPERATOR} to manage Tailscale without sudo"
tailscale set --operator="${OPERATOR}" || true

log "==> Ensure Tailscale CGNAT prefers table 52 (before hide.me default)"
# Remove previous copies of the same rule (idempotent).
while ip -4 rule del to "${TS_CGNAT_V4}" table 52 2>/dev/null; do :; done
while ip -6 rule del to "${TS_CGNAT_V6}" table 52 2>/dev/null; do :; done
ip -4 rule add to "${TS_CGNAT_V4}" table 52 pref "${RULE_PREF_V4}"
ip -6 rule add to "${TS_CGNAT_V6}" table 52 pref "${RULE_PREF_V6}" || true

log "==> Current Tailscale profiles"
tailscale switch --list || true

TARGET=''
while IFS= read -r line; do
  # Lines look like: "ID  name  ..." with optional *
  if echo "$line" | grep -Eiq 'regius|e35a97|labsys'; then
    TARGET=$(echo "$line" | awk '{print $1}' | tr -d '*')
    log "Found candidate profile line: $line"
  fi
done < <(tailscale switch --list 2>/dev/null || true)

if [[ -n "${TARGET}" ]]; then
  log "==> Switching Tailscale profile to ${TARGET}"
  tailscale switch "${TARGET}"
else
  log "==> No Regiuslabsys profile found in switch --list"
  log "    Will try to keep current login; create/login may need browser."
fi

log "==> Tailscale status (after switch)"
sleep 2
tailscale status || true
tailscale ip -4 || true

log "==> Route checks"
ip route get 100.94.144.13 || true
ip rule list | sed -n '1,40p'

log "Done. hide.me was NOT stopped."
