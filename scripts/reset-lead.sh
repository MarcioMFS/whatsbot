#!/usr/bin/env bash
# reset-lead.sh <phone> [bot_id]
# Resets a lead: clears Redis conversation, wipes DB fields, deletes open handoffs.
# Phone with or without 55 prefix.

set -euo pipefail

PHONE="${1:-}"
BOT_ID="${2:-2039b971-b290-4ff3-9964-ad78ff33dd3c}"

if [[ -z "$PHONE" ]]; then
  echo "Usage: $0 <phone> [bot_id]"
  echo "  e.g.: $0 5511933624809"
  exit 1
fi

# Strip non-digits, then ensure 55 prefix
PHONE="${PHONE//[^0-9]/}"
[[ "$PHONE" =~ ^55 ]] || PHONE="55${PHONE}"

psql() { PGPASSWORD=whatsbot123 command psql -h localhost -p 5435 -U whatsbot -d whatsbot "$@"; }
redis() { redis-cli -p 6381 "$@"; }

echo "Resetting lead $PHONE (bot $BOT_ID)..."

# 1. Redis — active conversation key
DELETED=$(redis del "conv:active:${BOT_ID}:${PHONE}")
echo "  Redis conv deleted: $DELETED"

# 2. Extra keys (dedup, recovery flags)
mapfile -t EXTRA < <(redis --scan --pattern "*${PHONE}*")
if [[ ${#EXTRA[@]} -gt 0 ]]; then
  redis del "${EXTRA[@]}" > /dev/null
  echo "  Extra Redis keys deleted: ${#EXTRA[@]}"
fi

# 3. Reset lead record
psql -c "UPDATE leads SET
  total_sessions=0, tags='{}', variables='{}', lead_temperature='cold',
  last_seen_at=NOW(), last_payment_confirmed_at=NULL,
  purchased_titles='[]', preferred_genres='[]', objections='[]',
  abandoned_pix_count=0, last_state=NULL, context_summary=NULL, recovery_sent_at=NULL
WHERE phone_number='$PHONE' AND bot_id='$BOT_ID';"
echo "  Lead DB record reset"

# 4. Delete open handoffs
psql -c "DELETE FROM handoffs WHERE phone_number='$PHONE' AND bot_id='$BOT_ID' AND status IN ('open','in_progress');"
echo "  Open handoffs deleted"

echo "Done — $PHONE is clean."
