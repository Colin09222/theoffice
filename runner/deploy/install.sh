#!/bin/bash
# office-runner installer for hz. Idempotent; run as root from a copy of the repo's runner/ folder:
#   bash deploy/install.sh [--with-browser-base]
# Prerequisites (see README.md, done once by hand with backups): gVisor's runsc installed and
# registered as the "runsc" Docker runtime. This script never restarts dockerd or any existing
# container, and never touches Caddy.
set -euo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
R=/opt/office-runner
BASE='node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d'
BROWSER='office-runner/browser:pw1.65.0'
OFFICE_GID=1000 # the Office container's user (node)

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
for rt in runsc runsc-build; do
  docker info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}' | grep -qw "$rt" || { echo "Docker has no $rt runtime yet (see daemon.json in README.md)" >&2; exit 1; }
done

install -d -m 0755 $R $R/app $R/bin $R/etc $R/firewall
install -d -m 0700 $R/state $R/secrets $R/secrets/apps $R/volumes $R/logs
install -d -m 0711 $R/mnt
install -d -m 0750 $R/shared
chown root:$OFFICE_GID $R/shared # no such group on the host; uutils install rejects a numeric -g

# Code, world-readable so the edge's throwaway user can load it; nothing secret in it.
rm -rf $R/app.new && mkdir -p $R/app.new
cp -R "$SRC/src" "$SRC/package.json" "$SRC/README.md" $R/app.new/
chmod -R u=rwX,go=rX $R/app.new
rm -rf $R/app.old && mv $R/app $R/app.old && mv $R/app.new $R/app && rm -rf $R/app.old

# Node for the daemons: the binary from the same digest-pinned image the apps build on.
if ! [ -x $R/bin/node ] || ! $R/bin/node -v | grep -q '^v22\.'; then
  docker pull -q "$BASE" > /dev/null
  cid=$(docker create "$BASE")
  docker cp "$cid:/usr/local/bin/node" $R/bin/node.new
  docker rm "$cid" > /dev/null
  chmod 0755 $R/bin/node.new && mv $R/bin/node.new $R/bin/node
fi

# Tokens: api (Phase 2 / operator), edge (edge -> control). Never printed.
for t in api edge; do
  [ -s $R/secrets/$t.token ] || (umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' > $R/secrets/$t.token)
done
chmod 0600 $R/secrets/*.token
# Phase 2's copy of the API token, readable by the Office container's group only.
install -m 0440 $R/secrets/api.token $R/shared/api.token
chown root:$OFFICE_GID $R/shared/api.token

# gVisor's network stack can't reach Docker's embedded DNS (127.0.0.11), so apps get Hetzner's resolvers, the only DNS the firewall allows.
[ -f $R/etc/resolv.conf ] || printf 'nameserver 185.12.64.1\nnameserver 185.12.64.2\noptions timeout:2 attempts:2\n' > $R/etc/resolv.conf
chmod 0644 $R/etc/resolv.conf
[ -f $R/etc/runner.json ] || printf '{\n  "MAX_APPS": 4,\n  "MAX_BROWSER_APPS": 2,\n  "IDLE_MINUTES": 15,\n  "APP_RESOLV_CONF": "/opt/office-runner/etc/resolv.conf"\n}\n' > $R/etc/runner.json
chmod 0644 $R/etc/runner.json
[ -f $R/etc/forbidden-secret-sha256 ] || install -m 0644 /dev/null $R/etc/forbidden-secret-sha256

install -m 0700 "$SRC/deploy/kill-all" $R/kill-all
install -m 0700 "$SRC/deploy/runnerctl" $R/bin/runnerctl
install -m 0700 "$SRC/deploy/deploy-dir.mjs" $R/bin/deploy-dir.mjs

# Networks. Fixed bridge names so the firewall can match them; no IPv6.
docker network inspect office-apps > /dev/null 2>&1 || docker network create --driver bridge \
  --subnet 172.30.0.0/24 --gateway 172.30.0.1 -o com.docker.network.bridge.name=br-office-apps \
  --label office.runner=network office-apps > /dev/null
docker network inspect office-build > /dev/null 2>&1 || docker network create --driver bridge \
  --subnet 172.30.1.0/24 --gateway 172.30.1.1 -o com.docker.network.bridge.name=br-office-build \
  --label office.runner=network office-build > /dev/null

# UFW drops all input except 22/80/443, so let build containers reach the egress proxy (and only that,
# only on the build bridge). The nft tables below narrow it further.
ufw status | grep -q '172.30.1.1 3128/tcp on br-office-build' || ufw allow in on br-office-build to 172.30.1.1 port 3128 proto tcp comment 'office-runner build egress proxy' > /dev/null

# Firewall first: the runner refuses to start apps without it.
install -m 0644 "$SRC/deploy/office-apps.nft" $R/firewall/office-apps.nft
nft -c -f $R/firewall/office-apps.nft
for u in office-apps-firewall office-runner office-runner-edge; do install -m 0644 "$SRC/deploy/$u.service" /etc/systemd/system/$u.service; done
systemctl daemon-reload
systemctl enable -q office-apps-firewall.service office-runner.service office-runner-edge.service
systemctl restart office-apps-firewall.service
systemctl restart office-runner.service
systemctl restart office-runner-edge.service

if [ "${1:-}" = --with-browser-base ] && ! docker image inspect "$BROWSER" > /dev/null 2>&1; then
  docker build -q -t "$BROWSER" -f "$SRC/deploy/browser-base.Dockerfile" "$SRC/deploy" > /dev/null
fi
docker pull -q "$BASE" > /dev/null
echo "office-runner installed: control $(systemctl is-active office-runner), edge $(systemctl is-active office-runner-edge), firewall $(systemctl is-active office-apps-firewall)"
