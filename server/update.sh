#!/usr/bin/env bash
# Gets the latest Auto Job code from GitHub, links the workflows to your n8n credentials, re-imports them
# and restarts everything. Run over SSH:  autojob-update
# Run it after adding or renaming a credential in n8n, and whenever the code on GitHub changes.
set -euo pipefail
APP="$HOME/auto-job"
cd "$APP"
echo "== Getting the latest code"
git pull --ff-only
npm ci --omit=dev || npm install
chmod +x ./*.sh scripts/*.sh server/*.sh
sudo install -m 755 server/autojob-setup.sh /usr/local/bin/autojob-setup
sudo install -m 755 server/update.sh /usr/local/bin/autojob-update

echo "== Linking credentials and importing workflows"
bash scripts/setup-credentials.sh
bash scripts/import-workflows.sh

echo "== Restarting n8n and the dashboard (n8n takes about a minute)"
systemctl --user restart autojob-n8n autojob-dashboard
. "$HOME/.autojob.env"
for i in $(seq 1 60); do curl -fs http://127.0.0.1:5678/healthz >/dev/null && break; sleep 3; done
curl -fs http://127.0.0.1:5678/healthz >/dev/null && echo "n8n is up." || echo "n8n is still starting. Check: journalctl --user -u autojob-n8n -n 50"
echo "Dashboard: https://$AUTOJOB_DOMAIN"
