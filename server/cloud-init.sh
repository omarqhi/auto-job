#!/bin/bash
# Paste this into Oracle Cloud when you create the VM: Show advanced options -> Management -> Paste cloud-init script.
# It installs everything on first boot (about 15 minutes). Progress: /var/log/autojob-install.log
curl -fsSL https://raw.githubusercontent.com/omarqhi/auto-job/main/server/install.sh | bash
