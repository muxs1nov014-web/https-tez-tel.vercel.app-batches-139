#!/bin/sh
# Cloudflare quick tunnel with a watchdog.
# Quick tunnels are not guaranteed: Cloudflare can drop one ("Tunnel not found"), and cloudflared then retries the
# dead tunnel forever. When /ready stays down, stop cloudflared and exit, so Docker restarts the container and
# cloudflared asks for a fresh tunnel. The bot picks up the new hostname from /quicktunnel (app/bot/panel_link.py).
set -u
GRACE="${WATCHDOG_GRACE_SECONDS:-60}"
INTERVAL="${WATCHDOG_INTERVAL_SECONDS:-10}"
MAX_FAILS="${WATCHDOG_MAX_FAILS:-6}"

cloudflared tunnel --no-autoupdate --metrics 0.0.0.0:20241 --url "${TUNNEL_TARGET:-http://web:80}" &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null; wait "$pid"; exit 0' TERM INT

pause() { sleep "$1" & wait $!; }  # interruptible, so `docker stop` is not delayed

pause "$GRACE"
fails=0
while kill -0 "$pid" 2>/dev/null; do
  if wget -q -T 5 -O /dev/null http://127.0.0.1:20241/ready; then
    fails=0
  else
    fails=$((fails + 1))
  fi
  if [ "$fails" -ge "$MAX_FAILS" ]; then
    echo "watchdog: tunnel not ready for $fails checks in a row, restarting for a new quick tunnel"
    kill -TERM "$pid"
    wait "$pid"
    exit 1
  fi
  pause "$INTERVAL"
done
wait "$pid"
exit 1
