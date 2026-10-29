#!/usr/bin/env bash
# One-time setup for DesignCritic AI on an Oracle Cloud "Always Free" Ubuntu VM.
# Run on the VM:  bash deploy/oracle-setup.sh   (from inside the cloned repo)
# Safe to re-run: it keeps an existing .env and only fills in what's missing.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }

say "Installing Docker"
if ! command -v docker >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true

say "Opening ports 80 and 443 in the VM firewall"
# Oracle's Ubuntu images ship iptables rules that block everything except SSH.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
sudo netfilter-persistent save

# The Next.js build needs a few GB of memory; add swap on small shapes.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 6000 ] && ! swapon --show | grep -q /swapfile; then
  say "Adding 4 GB swap"
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "Configuring settings (.env)"
touch .env && chmod 600 .env
setting() { grep -q "^$1=" .env && return; local value; if [ "${3:-}" = secret ]; then read -rsp "$2: " value; echo; else read -rp "$2: " value; fi; [ -n "$value" ] && echo "$1=$value" >> .env; return 0; }

if ! grep -q '^DOMAIN=' .env; then
  ip=$(curl -fsS https://api.ipify.org || true)
  default_domain="${ip//./-}.sslip.io"
  read -rp "Domain for HTTPS [${default_domain}]: " domain
  echo "DOMAIN=${domain:-$default_domain}" >> .env
fi
setting DESIGNCRITIC_PASSWORD "Choose an access password for the app" secret
echo "Free AI keys (press Enter to skip any you don't have):"
setting GEMINI_API_KEY "  Gemini API key" secret
setting GROQ_API_KEY "  Groq API key" secret
setting OPENROUTER_API_KEY "  OpenRouter API key" secret
echo "Optional free extras (Enter to skip):"
setting TAVILY_API_KEY "  Tavily API key" secret
setting UNSPLASH_ACCESS_KEY "  Unsplash access key" secret
setting PEXELS_API_KEY "  Pexels API key" secret
grep -q '^DESIGNCRITIC_CONTACT=' .env || echo "DESIGNCRITIC_CONTACT=$(grep '^DOMAIN=' .env | cut -d= -f2)" >> .env

if ! grep -q '^DESIGNCRITIC_PASSWORD=.' .env; then
  echo "An access password is required on a public server. Re-run this script and set one." >&2
  exit 1
fi

say "Building and starting (first build takes 5-10 minutes)"
sudo docker compose up -d --build

domain=$(grep '^DOMAIN=' .env | cut -d= -f2)
say "Done. Open https://${domain} (HTTPS can take a minute to issue the first time)."
echo "Logs: sudo docker compose logs -f app    Update later: bash deploy/update.sh"
