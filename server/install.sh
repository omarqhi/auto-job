#!/usr/bin/env bash
# Installs Auto Job on a fresh Ubuntu 24.04 server (made for Oracle Cloud's Always Free VM, works on any Ubuntu VM).
# Run once as root. Oracle runs it for you if you paste server/cloud-init.sh when creating the VM, or run:
#   curl -fsSL https://raw.githubusercontent.com/omarqhi/auto-job/main/server/install.sh | sudo bash
# Afterwards, sign in over SSH and run:  autojob-setup
# Log of the automatic run: /var/log/autojob-install.log
set -euo pipefail
exec > >(tee -a /var/log/autojob-install.log) 2>&1

REPO="${AUTOJOB_REPO:-https://github.com/omarqhi/auto-job.git}"
U="${SUDO_USER:-ubuntu}"
[ "$U" = "root" ] && U=ubuntu
H="$(getent passwd "$U" | cut -d: -f6)"
APP="$H/auto-job"
UID_N="$(id -u "$U")"
as_user() { sudo -u "$U" -H env XDG_RUNTIME_DIR="/run/user/$UID_N" "$@"; }
export DEBIAN_FRONTEND=noninteractive

echo "== $(date) Installing Auto Job for user $U in $APP"

echo "== System packages"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg build-essential python3 \
  debian-keyring debian-archive-keyring apt-transport-https iptables-persistent \
  fonts-liberation fonts-crosextra-carlito

# Small VMs (the 1 GB AMD shape) need swap to build n8n and run Chromium.
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 4000 ] && ! swapon --show | grep -q .; then
  echo "== Adding 4 GB swap"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Node.js 24"
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== Caddy (HTTPS in front of the dashboard and n8n)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
# Until autojob-setup sets a password, nothing is served.
if ! grep -q autojob /etc/caddy/Caddyfile 2>/dev/null; then
  printf '# autojob: run autojob-setup to finish\n:80 {\n\trespond "Auto Job is installed. Run autojob-setup on the server to finish." 200\n}\n' > /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
fi

echo "== Opening ports 80 and 443 (Oracle's Ubuntu image blocks them by default)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null && continue
  n="$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')"   # must come before the image's catch-all REJECT
  if [ -n "$n" ]; then iptables -I INPUT "$n" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
  else iptables -A INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT; fi
done
netfilter-persistent save

echo "== n8n and Claude Code"
npm install -g n8n @anthropic-ai/claude-code
n8n --version
claude --version

echo "== Auto Job code"
if [ -d "$APP/.git" ]; then as_user git -C "$APP" pull --ff-only; else as_user git clone "$REPO" "$APP"; fi
cd "$APP"
as_user npm ci --omit=dev || as_user npm install
[ -f config.json ] || as_user cp config.example.json config.json
[ -f resume/master-resume.md ] || as_user cp resume/master-resume.example.md resume/master-resume.md
# The LinkedIn feed check needs Chrome on your own PC, so it is off on the server.
as_user node -e "const f='config.json',c=require('./'+f);c.linkedin={...(c.linkedin||{}),checkFeed:false};require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n')"
as_user mkdir -p "$H/.claude/skills" logs
for s in .claude/skills/*/; do n="$(basename "$s")"; [ -d "$H/.claude/skills/$n" ] || as_user cp -r "$s" "$H/.claude/skills/$n"; done
chmod +x ./*.sh scripts/*.sh server/*.sh

echo "== Chromium for the resume PDFs"
as_user npx -y playwright@1.52.0 install chromium
npx -y playwright@1.52.0 install-deps chromium
CHROME="$(find "$H/.cache/ms-playwright" -type f -name chrome -path '*chromium-*' | head -1)"
[ -n "$CHROME" ] || { echo "Chromium was not found after installing it"; exit 1; }

echo "== Settings file $H/.autojob.env"
IP="$(curl -4 -fsS https://api.ipify.org || true)"
DOMAIN="${AUTOJOB_DOMAIN:-${IP}.sslip.io}"   # sslip.io turns the server's IP into a name, so HTTPS works without buying a domain
ENVF="$H/.autojob.env"
as_user touch "$ENVF"; chmod 600 "$ENVF"
setenv() { grep -q "^$1=" "$ENVF" && sed -i "s|^$1=.*|$1=$2|" "$ENVF" || echo "$1=$2" >> "$ENVF"; }
setenv AUTOJOB_DOMAIN "$DOMAIN"
setenv CHROME_PATH "$CHROME"
setenv N8N_HOST "n8n.$DOMAIN"
setenv N8N_PROTOCOL https
setenv N8N_EDITOR_BASE_URL "https://n8n.$DOMAIN/"
setenv WEBHOOK_URL "https://n8n.$DOMAIN/"
setenv N8N_PROXY_HOPS 1
chown "$U:$U" "$ENVF"

echo "== Services (run as $U, start at boot, restart if they crash)"
loginctl enable-linger "$U"
for i in $(seq 1 30); do [ -S "/run/user/$UID_N/bus" ] && break; sleep 1; done
UNITS="$H/.config/systemd/user"
as_user mkdir -p "$UNITS"
cat > "$UNITS/autojob-n8n.service" <<EOF
[Unit]
Description=Auto Job - n8n
After=network-online.target

[Service]
ExecStart=/bin/bash $APP/start-n8n.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
cat > "$UNITS/autojob-dashboard.service" <<EOF
[Unit]
Description=Auto Job - dashboard
After=network-online.target

[Service]
WorkingDirectory=$APP
EnvironmentFile=$ENVF
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=TZ=Asia/Karachi
ExecStart=/usr/bin/node $APP/dashboard/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
chown -R "$U:$U" "$H/.config"
as_user systemctl --user daemon-reload
as_user systemctl --user enable --now autojob-n8n autojob-dashboard

echo "== Building the workflow files"
as_user node scripts/build-workflows.js

install -m 755 server/autojob-setup.sh /usr/local/bin/autojob-setup
install -m 755 server/update.sh /usr/local/bin/autojob-update

echo "== Done $(date). Next: sign in over SSH as $U and run: autojob-setup"
echo "   Your addresses will be https://$DOMAIN (dashboard) and https://n8n.$DOMAIN (n8n)"
