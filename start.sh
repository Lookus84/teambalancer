#!/usr/bin/env bash
# Запуск «Баланса команд» на этом Mac, чтобы открыть с телефона в той же сети.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8899}"

# Адрес берём с интерфейса, через который идёт маршрут по умолчанию:
# это может быть Wi-Fi (en0), USB-Ethernet (en6) или что-то ещё.
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IP=""

if [ -n "${IFACE:-}" ]; then
  IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
fi

# запасной путь: любой приватный IPv4
if [ -z "$IP" ]; then
  IP="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -E '^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.' | head -1 || true)"
fi

# постоянное имя Mac в локальной сети (Bonjour) — адрес не меняется
HOSTNAME_LOCAL="$(scutil --get LocalHostName 2>/dev/null || true)"

echo ""
echo "  Баланс команд"
echo "  ---------------"
echo "  На этом Mac : http://localhost:${PORT}/"
if [ -n "$IP" ]; then
  echo "  С телефона  : http://${IP}:${PORT}/"
else
  echo "  С телефона  : не нашёл сетевой адрес (нет Wi-Fi/Ethernet?)"
fi
if [ -n "${HOSTNAME_LOCAL:-}" ]; then
  echo "  По имени    : http://${HOSTNAME_LOCAL}.local:${PORT}/   (адрес не меняется)"
fi
echo ""
echo "  Телефон должен быть в той же сети, что и Mac."
echo "  Mac не должен засыпать: пока он спит, страница не откроется."
echo "  Остановить — Ctrl+C."
echo ""

cd "$DIR"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
