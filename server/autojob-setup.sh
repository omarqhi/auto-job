#!/usr/bin/env bash
# Finishes the server install: your details, the web password, and Claude's sign-in. Run over SSH:  autojob-setup
# Safe to run again (for example to change the password or renew Claude's sign-in): press Enter to keep a value.
set -euo pipefail
APP="$HOME/auto-job"
ENVF="$HOME/.autojob.env"
cd "$APP"
[ -f "$ENVF" ] || { echo "Run server/install.sh first."; exit 1; }
. "$ENVF"
setenv() { grep -q "^$1=" "$ENVF" && sed -i "s|^$1=.*|$1=$2|" "$ENVF" || echo "$1=$2" >> "$ENVF"; }
cfg() { node -e "const c=require('./config.json');const v=$1;process.stdout.write(Array.isArray(v)?v.join(', '):String(v??''))"; }
ask() { local cur; cur="$(cfg "$2")"; read -r -p "$1 [$cur]: " v; echo "${v:-$cur}"; }

echo
echo "== 1/3 Your details (used in your resume, cover letters and emails)"
NAME="$(ask 'Full name' 'c.candidate.name')"
EMAIL="$(ask 'Email (your Gmail)' 'c.candidate.email')"
PHONE="$(ask 'Phone' 'c.candidate.phone')"
LINKEDIN="$(ask 'LinkedIn profile' 'c.candidate.linkedin')"
CITY="$(ask 'City' 'c.candidate.city')"
KEYWORDS="$(ask 'Job titles to search for, separated by commas' 'c.search.keywords')"
NAME="$NAME" EMAIL="$EMAIL" PHONE="$PHONE" LINKEDIN="$LINKEDIN" CITY="$CITY" KEYWORDS="$KEYWORDS" node -e "
const fs=require('fs'),c=require('./config.json'),e=process.env;
Object.assign(c.candidate,{name:e.NAME,email:e.EMAIL,phone:e.PHONE,linkedin:e.LINKEDIN,city:e.CITY});
c.search.keywords=e.KEYWORDS.split(',').map(s=>s.trim()).filter(Boolean);
fs.writeFileSync('config.json',JSON.stringify(c,null,2)+'\n');"
echo "Saved. You can change these later in the dashboard's Settings."

echo
echo "== 2/3 Web password (protects the dashboard and n8n; the user name is: autojob)"
if [ -n "${AUTOJOB_PW_SET:-}" ]; then echo "A password is already set. Press Enter to keep it."; fi
while true; do
  read -r -s -p "New password (at least 10 characters): " PW; echo
  if [ -z "$PW" ] && [ -n "${AUTOJOB_PW_SET:-}" ]; then break; fi
  [ "${#PW}" -ge 10 ] || { echo "Too short."; continue; }
  read -r -s -p "Same password again: " PW2; echo
  [ "$PW" = "$PW2" ] || { echo "They don't match."; continue; }
  HASH="$(caddy hash-password --plaintext "$PW")"
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
# autojob: written by autojob-setup
$AUTOJOB_DOMAIN {
	basic_auth {
		autojob $HASH
	}
	reverse_proxy 127.0.0.1:5680 {
		header_up Host localhost:5680
		header_up -Authorization
	}
}

n8n.$AUTOJOB_DOMAIN {
	basic_auth {
		autojob $HASH
	}
	reverse_proxy 127.0.0.1:5678 {
		header_up -Authorization
	}
}
EOF
  sudo systemctl reload caddy
  setenv AUTOJOB_PW_SET 1
  break
done

echo
echo "== 3/3 Claude sign-in (uses your Claude subscription; nothing is billed per request)"
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  read -r -p "Claude is already signed in. Sign in again? [y/N]: " again
else again=y; fi
if [[ "$again" =~ ^[Yy] ]]; then
  echo "A link appears below. Open it on your phone or any browser, sign in to Claude, and paste the code back here."
  claude setup-token || true
  read -r -s -p "Paste the token it printed (starts with sk-ant-): " TOKEN; echo
  [[ "$TOKEN" == sk-ant-* ]] || { echo "That doesn't look like a token. Run autojob-setup again."; exit 1; }
  setenv CLAUDE_CODE_OAUTH_TOKEN "$TOKEN"
  export CLAUDE_CODE_OAUTH_TOKEN="$TOKEN"
fi
echo "Checking Claude..."
if echo "Reply with the single word OK." | claude -p --model haiku 2>&1 | grep -qi ok; then echo "Claude works."; else echo "Claude did not answer. Run autojob-setup again and sign in."; fi

systemctl --user restart autojob-n8n autojob-dashboard

cat <<EOF

== Done
Dashboard:  https://$AUTOJOB_DOMAIN
n8n:        https://n8n.$AUTOJOB_DOMAIN
Both ask for user "autojob" and your password. The first visit can take a minute while the HTTPS certificate is made.

Next (see ORACLE.md, part 4):
  1. Open n8n, create your n8n owner account, and add the credentials Apify API, Gmail account and Google Calendar account.
     Google redirect URI: https://n8n.$AUTOJOB_DOMAIN/rest/oauth2-credential/callback
  2. Then run:  autojob-update
  3. In the dashboard: upload your resume (Master resume) and switch on "Apply every day" and "Watch replies".
EOF
