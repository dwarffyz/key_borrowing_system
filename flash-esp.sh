#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESP_DIR="$ROOT_DIR/hardware/esp32-locker-controller"
ENV_FILE="$ROOT_DIR/public/.env"
TOOLS_DIR="$ROOT_DIR/.tools"
SUMMARY_FILE="$TOOLS_DIR/flash-esp-linux-summary.txt"

PORT="${ESP_PORT:-}"
ERASE_FLASH=0
SKIP_PROVISION=0
PORTAL_MODE="${ESP_PORTAL_MODE:-buttons}"
APP_URL="${ESP_APP_URL:-}"
STA_SSID="${ESP_STA_SSID:-}"
STA_PASSWORD="${ESP_STA_PASSWORD:-}"

log() { printf '\n[esp-flash] %s\n' "$*"; }
warn() { printf '\n[warning] %s\n' "$*" >&2; }
die() { printf '\n[error] %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<'EOF'
Usage: ./flash-esp.sh [options]

Options:
  --port /dev/ttyUSB0       Serial port. Auto-detected when omitted.
  --erase                   Erase flash before flashing firmware.
  --ssid "WiFi Name"        Save router WiFi SSID to ESP after flashing.
  --password "WiFi Pass"    Save router WiFi password to ESP after flashing.
  --app-url URL             Save app URL to ESP portal after flashing.
  --portal-mode buttons     ESP portal mode: buttons or redirect.
  --skip-provision          Flash only; do not send serial configuration.
  -h, --help                Show this help.

Environment alternatives:
  ESP_PORT, ESP_STA_SSID, ESP_STA_PASSWORD, ESP_APP_URL, ESP_PORTAL_MODE
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --erase) ERASE_FLASH=1; shift ;;
    --ssid) STA_SSID="${2:-}"; shift 2 ;;
    --password) STA_PASSWORD="${2:-}"; shift 2 ;;
    --app-url) APP_URL="${2:-}"; shift 2 ;;
    --portal-mode) PORTAL_MODE="${2:-}"; shift 2 ;;
    --skip-provision) SKIP_PROVISION=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

read_env() {
  local name="$1"
  local fallback="${2:-}"
  if [[ -f "$ENV_FILE" ]]; then
    local line
    line="$(grep -E "^[[:space:]]*$name[[:space:]]*=" "$ENV_FILE" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      printf '%s' "${line#*=}" | sed 's/^"//; s/"$//'
      return
    fi
  fi
  printf '%s' "$fallback"
}

set_env() {
  local name="$1"
  local value="$2"
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" && -f "$ROOT_DIR/public/.env.example" ]]; then
    cp "$ROOT_DIR/public/.env.example" "$ENV_FILE"
  fi
  touch "$ENV_FILE"
  if grep -qE "^[[:space:]]*$name[[:space:]]*=" "$ENV_FILE"; then
    python3 - "$ENV_FILE" "$name" "$value" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
name = sys.argv[2]
value = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines()
for i, line in enumerate(lines):
    if line.strip().startswith(name + "="):
        lines[i] = f"{name}={value}"
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
  else
    printf '\n%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}

detect_port() {
  if [[ -n "$PORT" ]]; then
    printf '%s' "$PORT"
    return
  fi

  local candidate
  for candidate in /dev/serial/by-id/* /dev/ttyUSB* /dev/ttyACM* /dev/cu.usbserial* /dev/cu.SLAB_USBtoUART* /dev/cu.wchusbserial*; do
    if [[ -e "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done

  die "No ESP serial port detected. Plug in the ESP32, then run ./flash-esp.sh --port /dev/ttyUSB0"
}

ensure_idf() {
  if have idf.py; then
    return
  fi

  local exports=(
    "$HOME/esp/esp-idf/export.sh"
    "$HOME/esp-idf/export.sh"
    "$HOME/Espressif/esp-idf/export.sh"
    "/opt/esp/idf/export.sh"
  )
  local export_file
  for export_file in "${exports[@]}"; do
    if [[ -f "$export_file" ]]; then
      # shellcheck disable=SC1090
      source "$export_file"
      have idf.py && return
    fi
  done

  die "ESP-IDF was not found. Install ESP-IDF, source export.sh, then run ./flash-esp.sh again."
}

ensure_serial_permissions() {
  local port="$1"
  if [[ ! -r "$port" || ! -w "$port" ]]; then
    warn "Current user may not have serial permission for $port."
    warn "Linux fix: sudo usermod -aG dialout,uucp $USER && log out/in."
  fi
}

ensure_pyserial() {
  have python3 || die "Python 3 is required for automatic ESP provisioning."
  if python3 - <<'PY' >/dev/null 2>&1
import serial
PY
  then
    return
  fi

  warn "pyserial missing. Installing to user site packages..."
  python3 -m pip install --user pyserial
}

default_app_url() {
  local port
  port="$(read_env PORT 3000)"
  if [[ -n "$APP_URL" ]]; then
    printf '%s' "$APP_URL"
    return
  fi
  if have ip; then
    local ip_addr
    ip_addr="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
    if [[ -n "$ip_addr" ]]; then
      printf 'http://%s:%s' "$ip_addr" "$port"
      return
    fi
  fi
  printf 'http://localhost:%s' "$port"
}

send_serial_config() {
  local port="$1"
  local app_url="$2"
  local ssid="$3"
  local password="$4"
  local portal_mode="$5"

  python3 - "$port" "$app_url" "$ssid" "$password" "$portal_mode" <<'PY'
import sys
import time
import serial

port, app_url, ssid, password, portal_mode = sys.argv[1:6]

def exchange(ser, command, wait=4.5):
    ser.reset_input_buffer()
    ser.write((command + "\n").encode("utf-8"))
    ser.flush()
    deadline = time.time() + wait
    data = b""
    while time.time() < deadline:
        chunk = ser.read(256)
        if chunk:
            data += chunk
            text = data.decode("utf-8", errors="ignore")
            if "SERIAL_OK" in text or "SERIAL_STATUS" in text or "SERIAL_ERROR" in text:
                return text.strip()
        time.sleep(0.05)
    return data.decode("utf-8", errors="ignore").strip()

with serial.Serial(port, 115200, timeout=0.2, write_timeout=2) as ser:
    time.sleep(2.0)
    results = []
    if ssid:
        results.append(exchange(ser, f"SET_STA {ssid}|{password}", 6.5))
    if app_url:
        results.append(exchange(ser, f"SET_URL {app_url}", 6.5))
    if portal_mode:
        results.append(exchange(ser, f"SET_PORTAL_MODE {portal_mode}", 4.5))
    results.append(exchange(ser, "STATUS", 5.0))

for result in results:
    if result:
        print(result)
PY
}

main() {
  mkdir -p "$TOOLS_DIR"
  : > "$SUMMARY_FILE"

  [[ -d "$ESP_DIR" ]] || die "Missing ESP project: $ESP_DIR"

  if [[ -z "$STA_SSID" ]]; then STA_SSID="$(read_env ESP_STA_SSID '')"; fi
  if [[ -z "$STA_PASSWORD" ]]; then STA_PASSWORD="$(read_env ESP_STA_PASSWORD '')"; fi
  local resolved_port
  resolved_port="$(detect_port)"
  local app_url
  app_url="$(default_app_url)"

  log "Using ESP serial port: $resolved_port"
  ensure_serial_permissions "$resolved_port"
  ensure_idf

  log "Building and flashing ESP32 firmware..."
  (cd "$ESP_DIR" && idf.py set-target esp32)
  if [[ "$ERASE_FLASH" == "1" ]]; then
    (cd "$ESP_DIR" && idf.py -p "$resolved_port" erase-flash)
  fi
  (cd "$ESP_DIR" && idf.py -p "$resolved_port" flash)

  set_env LOCKER_CONTROLLER_SERIAL_PORT "$resolved_port"
  set_env LOCKER_CONTROLLER_SERIAL_AUTO_DETECT true

  if [[ "$SKIP_PROVISION" == "1" ]]; then
    warn "Skipping automatic ESP provisioning."
  else
    ensure_pyserial
    log "Provisioning ESP portal and WiFi settings..."
    send_serial_config "$resolved_port" "$app_url" "$STA_SSID" "$STA_PASSWORD" "$PORTAL_MODE" | tee "$SUMMARY_FILE"
  fi

  {
    printf 'ESP flash completed\n'
    printf 'Port: %s\n' "$resolved_port"
    printf 'App URL: %s\n' "$app_url"
    printf 'Portal mode: %s\n' "$PORTAL_MODE"
    printf 'Station WiFi: %s\n' "${STA_SSID:-not configured}"
  } >> "$SUMMARY_FILE"

  log "Done. Summary saved to $SUMMARY_FILE"
}

main "$@"

