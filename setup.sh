#!/usr/bin/env bash
#
# sms-mcp one-shot setup for Termux (Android).
#
# What it does:
#   1. Upgrades Termux packages (fixes the node/OpenSSL link error) and installs
#      termux-api, nodejs, git.
#   2. Clones the repo (if not already inside it) and builds the server.
#   3. Creates config.json with a fresh bearer token and your Tailscale host.
#   4. Installs a Termux:Boot script that runs the server (with wake-lock and
#      crash-restart) on every reboot.
#   5. Prints the exact `claude mcp add` command for your laptop.
#
# Usage (on the phone, in Termux):
#   curl -fsSL https://raw.githubusercontent.com/codeWonderland/sms-mcp/main/setup.sh -o setup.sh
#   bash setup.sh
#
# Re-running is safe: an existing config.json is never overwritten.
#
# Optional env overrides (skip the prompt):
#   SMS_MCP_HOST=100.x.y.z bash setup.sh
#
set -euo pipefail

REPO_URL="https://github.com/codeWonderland/sms-mcp.git"

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. Environment ---------------------------------------------------------
IS_TERMUX=0
[ -d /data/data/com.termux/files ] && IS_TERMUX=1

# --- 1. Packages (the node/OpenSSL fix lives here) --------------------------
if [ "$IS_TERMUX" -eq 1 ]; then
  say "Upgrading Termux packages (this fixes the node 'OSSL_PROVIDER' link error)"
  pkg update -y
  pkg upgrade -y
  say "Installing termux-api, nodejs, git"
  pkg install -y termux-api nodejs git
else
  warn "Not running inside Termux — skipping package install."
  warn "You still need Node 18+ and git on PATH for the build to work."
fi

command -v node >/dev/null 2>&1 || die "node not found. Re-run inside Termux, or install Node 18+."
command -v git  >/dev/null 2>&1 || die "git not found."

# --- 2. Locate or clone the repo --------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/server" ]; then
  REPO_DIR="$SCRIPT_DIR"
else
  REPO_DIR="$HOME/sms-mcp"
  if [ -d "$REPO_DIR/.git" ]; then
    say "Updating existing clone at $REPO_DIR"
    git -C "$REPO_DIR" pull --ff-only || warn "Could not fast-forward; using existing checkout."
  else
    say "Cloning $REPO_URL -> $REPO_DIR"
    git clone "$REPO_URL" "$REPO_DIR"
  fi
fi
SERVER_DIR="$REPO_DIR/server"
[ -d "$SERVER_DIR" ] || die "server/ not found under $REPO_DIR"

# --- 3. Build ---------------------------------------------------------------
say "Installing npm dependencies"
( cd "$SERVER_DIR" && npm install )
say "Building"
( cd "$SERVER_DIR" && npm run build )

# --- 4. Config --------------------------------------------------------------
CONFIG="$SERVER_DIR/config.json"
if [ -f "$CONFIG" ]; then
  say "config.json already exists — leaving it untouched."
else
  say "Creating config.json"
  cp "$SERVER_DIR/config.example.json" "$CONFIG"

  # Host: Tailscale IP (or loopback). Env override wins; else prompt.
  HOST_IP="${SMS_MCP_HOST:-}"
  if [ -z "$HOST_IP" ]; then
    if [ -e /dev/tty ]; then
      printf "Enter this phone's Tailscale IP (100.x.y.z), blank for loopback [127.0.0.1]: "
      read -r HOST_IP < /dev/tty || true
    fi
    HOST_IP="${HOST_IP:-127.0.0.1}"
  fi

  TOKEN="$( cd "$SERVER_DIR" && node dist/scripts/gen-token.js )"

  TOKEN="$TOKEN" HOST_IP="$HOST_IP" node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const c = JSON.parse(fs.readFileSync(p, "utf8"));
    c.bearerToken = process.env.TOKEN;
    c.host = process.env.HOST_IP;
    c.allowLanBind = !["127.0.0.1", "::1", "localhost"].includes(process.env.HOST_IP);
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
  ' "$CONFIG"
  say "Wrote token + host ($HOST_IP) into config.json"
  warn "Edit $CONFIG to set your recipient allowlist before relying on it."
fi

# --- 5. Termux:Boot script --------------------------------------------------
if [ "$IS_TERMUX" -eq 1 ]; then
  say "Installing Termux:Boot script"
  BOOT_DIR="$HOME/.termux/boot"
  BOOT_FILE="$BOOT_DIR/start-sms-mcp.sh"
  mkdir -p "$BOOT_DIR"
  # Note: $SERVER_DIR is baked in now; runtime vars are escaped (\$).
  cat > "$BOOT_FILE" <<BOOT
#!/data/data/com.termux/files/usr/bin/sh
# Keep the CPU awake so Android doesn't suspend the server.
termux-wake-lock

LOGDIR="$SERVER_DIR/state"
mkdir -p "\$LOGDIR"
cd "$SERVER_DIR" || exit 1

# Supervise: if the server ever exits, restart it after 5s.
while true; do
  node dist/index.js >> "\$LOGDIR/boot.log" 2>&1
  echo "[\$(date)] sms-mcp exited, restarting in 5s" >> "\$LOGDIR/boot.log"
  sleep 5
done
BOOT
  chmod +x "$BOOT_FILE"
  say "Boot script: $BOOT_FILE"
else
  warn "Not in Termux — skipping the boot script."
fi

# --- 6. Final instructions --------------------------------------------------
HOST_SHOW="$( node -e 'const c=require(process.argv[1]);console.log(c.host)' "$CONFIG" )"
PORT_SHOW="$( node -e 'const c=require(process.argv[1]);console.log(c.port)' "$CONFIG" )"
TOKEN_SHOW="$( node -e 'const c=require(process.argv[1]);console.log(c.bearerToken)' "$CONFIG" )"

cat <<DONE

============================================================
 sms-mcp setup complete.
============================================================

Server dir : $SERVER_DIR
Endpoint   : http://$HOST_SHOW:$PORT_SHOW/mcp

STILL TO DO BY HAND (Android won't let a script do these):
  1. Open the Termux:Boot app once (it won't run boot scripts until you have).
  2. Settings -> Apps -> Termux -> Battery -> Unrestricted (so Android won't
     kill the server). Do the same for Termux:API.
  3. Edit your allowlist in: $SERVER_DIR/config.json

START IT NOW (foreground, for testing):
  cd "$SERVER_DIR" && npm start
...or just reboot the phone to test the boot script.

ON YOUR LAPTOP, register the MCP server globally (token included):
  claude mcp add -s user --transport http sms \\
    http://$HOST_SHOW:$PORT_SHOW/mcp \\
    --header "Authorization: Bearer $TOKEN_SHOW"

Keep that token private — it's the password to send SMS as you.
============================================================
DONE
