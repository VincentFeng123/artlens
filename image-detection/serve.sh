#!/usr/bin/env bash
# Serve RECTO over your local network so your phone (same Wi-Fi) can reach it.
# Auto-picks a free port so it never clashes with other servers you have running.
# Usage:  bash serve.sh [preferred-port]   (default starts looking at 8000)
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

START_PORT="${1:-8000}"

# Find the first free TCP port at or above START_PORT.
PORT=""
p="$START_PORT"
end=$((START_PORT + 60))
while [ "$p" -lt "$end" ]; do
  if python3 -c "
import socket, sys
s = socket.socket()
try:
    s.bind(('0.0.0.0', $p)); s.close()
except OSError:
    sys.exit(1)
" 2>/dev/null; then
    PORT="$p"; break
  fi
  p=$((p + 1))
done
if [ -z "$PORT" ]; then
  echo "Couldn't find a free port between $START_PORT and $end. Try: bash serve.sh 9000"
  exit 1
fi

# Best-effort LAN IP for the phone URL.
IP=""
for IFACE in en0 en1 en2 en3; do
  CAND="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
  [ -n "$CAND" ] && { IP="$CAND"; break; }
done

echo ""
echo "  ⌐ RECTO — Artwork Rectifier"
echo "  ───────────────────────────────────────────────"
echo "  On this Mac:   http://localhost:$PORT"
if [ -n "$IP" ]; then
  echo "  On your phone: http://$IP:$PORT   (must be on the same Wi-Fi)"
else
  echo "  (LAN IP not found automatically — run: ipconfig getifaddr en0)"
fi
echo "  ───────────────────────────────────────────────"
echo "  Tip: the upload area lets the phone take a photo or pick from its library."
echo "  Press Ctrl+C to stop."
echo ""

exec python3 -m http.server "$PORT" --bind 0.0.0.0
