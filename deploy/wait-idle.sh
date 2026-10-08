#!/bin/sh
# deploy/wait-idle.sh — wait until the live server runs no match, then print one line and exit (wjx instance).
#
#   deploy/wait-idle.sh [url] [interval_s]      (default http://127.0.0.1:3100/healthz, every 30 s)
#
# Idle = /healthz reports matches 0 on two checks in a row (a match between two rounds still counts as running; the
# second check rules out a room that is just starting). Lobby rooms without a match do not hold it back: a restart
# only sends their players back to the lobby. Exit 0 when idle; exit 2 when the server stays unreachable for 10 checks.

URL=${1:-http://127.0.0.1:3100/healthz}
EVERY=${2:-30}
idle=0
down=0
while :; do
  h=$(curl -fsS --max-time 5 "$URL" 2>/dev/null)
  if [ -z "$h" ]; then
    down=$((down + 1))
    if [ "$down" -ge 10 ]; then echo "wait-idle: $URL unreachable for $down checks"; exit 2; fi
  else
    down=0
    matches=$(printf '%s' "$h" | sed -n 's/.*"matches":\([0-9]*\).*/\1/p')
    if [ "${matches:-1}" = "0" ]; then idle=$((idle + 1)); else idle=0; fi
    if [ "$idle" -ge 2 ]; then
      echo "可以部署了：$(date '+%F %T') 没有进行中的对局 — $h"
      exit 0
    fi
  fi
  sleep "$EVERY"
done
