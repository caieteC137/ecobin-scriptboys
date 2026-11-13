#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
target="${ECOBIN_SSH_TARGET:-azureuser@20.98.42.169}"
key="${ECOBIN_SSH_KEY:-$HOME/.ssh/vm-openbot-finance_key.pem}"
ssh_opts=(-i "$key" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes)
git rev-parse --is-inside-work-tree >/dev/null
if [[ -z "$(git ls-files cloud/compose.yaml)" ]]; then
  echo 'Adicione os arquivos do projeto ao Git antes de publicar.' >&2
  exit 1
fi
ssh "${ssh_opts[@]}" "$target" 'test -s ~/ecobin/cloud/.env' || {
  echo 'Configure primeiro ~/ecobin/cloud/.env na VM conforme cloud/README.md.' >&2
  exit 1
}
tar -czf - --null --files-from=<(git ls-files -z) |
  ssh "${ssh_opts[@]}" "$target" 'umask 077; mkdir -p ~/ecobin; tar -xzf - -C ~/ecobin'
ssh "${ssh_opts[@]}" "$target" 'cd ~/ecobin/cloud && sudo -n docker compose config -q && sudo -n docker compose up -d --build && sudo -n docker compose ps'
