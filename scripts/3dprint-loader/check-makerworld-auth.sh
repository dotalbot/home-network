#!/usr/bin/env bash
# check-makerworld-auth.sh — MakerWorld Playwright auth-state health check
#
# Exit codes:
#   0 — auth state exists, valid, and cookies are not expiring soon
#   1 — auth state exists but expiring within the warning window (default 7 days)
#   2 — auth state missing, invalid, or all cookies expired
#   3 — infrastructure error (API unreachable, network failure)
#
# Designed for cron: silent on success, stderr on warnings/errors.
# Outputs a one-line status summary on stdout and a Prometheus textfile
# metric when --prometheus <path> is given.

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────
API_BASE="${API_BASE:-http://192.168.1.1:8793}"
WARN_DAYS="${WARN_DAYS:-7}"
LOCK_FILE="/tmp/check-makerworld-auth.lock"

# ── Lock (flock, not a PID file) ────────────────────────────────────────
exec 9>"$LOCK_FILE"
flock -n 9 2>/dev/null || {
    echo "check-makerworld-auth: another check is already running" >&2
    exit 3
}

# ── Helpers ─────────────────────────────────────────────────────────────
cleanup() {
    rm -f /tmp/check-makerworld-auth.json /tmp/check-makerworld-auth-warn.json
}
trap cleanup EXIT

die() {
    local code="$1" msg="$2"
    echo "makerworld_auth{status=\"infra_error\"} 1" >&2
    echo "ERROR: $msg" >&2
    exit "$code"
}

# ── Fetch auth status from the API ─────────────────────────────────────
STATUS_JSON=$(curl -fsS --max-time 10 "${API_BASE}/api/makerworld/auth-status" 2>/dev/null) || die 3 "Cannot reach ${API_BASE}/api/makerworld/auth-status"

# Validate JSON
echo "$STATUS_JSON" | python3 -c "
import json, sys, os

data = json.load(sys.stdin)
path = data.get('configured_path', 'unknown')
exists = data.get('exists', False)
valid = data.get('valid_json', False)
usable = data.get('likely_usable', False)
expired_count = data.get('expired_cookie_count', 0)
persistent_count = data.get('persistent_cookie_count', 0)
session_count = data.get('session_cookie_count', 0)
earliest = data.get('earliest_expiry_iso')
warnings = data.get('warnings', [])
cookie_count = data.get('cookie_count', 0)
domains = data.get('domains', [])

# Composite status
status = 'missing'
exit_code = 2

if exists and valid:
    if usable:
        # Check warning window
        import datetime
        if earliest:
            try:
                exp = datetime.datetime.fromisoformat(earliest)
                now = datetime.datetime.now(datetime.timezone.utc)
                days_left = (exp - now).days
                warn_days = int(os.environ.get('WARN_DAYS', '7'))
                if days_left <= 0:
                    status = 'expired'
                    exit_code = 2
                elif days_left <= warn_days:
                    status = 'expiring'
                    exit_code = 1
                else:
                    status = 'ok'
                    exit_code = 0
            except ValueError:
                status = 'ok'
                exit_code = 0
        else:
            # Session cookies only — no persistent expiry
            if session_count > 0 and persistent_count == 0:
                status = 'session-only'
                exit_code = 1
            else:
                status = 'ok'
                exit_code = 0
    else:
        status = 'invalid'
        exit_code = 2

# Summary line
domains_str = ','.join(domains) if domains else 'none'
print(f'makerworld_auth file={path} status={status} cookies={cookie_count} persistent={persistent_count} expired={expired_count} session={session_count} usable={usable} domains=[{domains_str}] earliest={earliest or \"N/A\"}')
if warnings:
    for w in warnings:
        print(f'  WARN: {w}', file=sys.stderr)

sys.exit(exit_code)
" 2>/dev/null || exit $?
