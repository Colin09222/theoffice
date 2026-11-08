#!/bin/bash
# Saves everything the office-runner install touches, before touching it. Prints the backup folder.
set -euo pipefail
TS=$(date -u +%Y%m%d-%H%M%S)
B=/root/office-runner-backup-$TS
mkdir -p -m 0700 "$B"
cp -a /opt/edge/Caddyfile "$B/Caddyfile"
md5sum /opt/edge/Caddyfile > "$B/Caddyfile.md5"
if [ -f /etc/docker/daemon.json ]; then cp -a /etc/docker/daemon.json "$B/daemon.json"; else echo "/etc/docker/daemon.json did not exist" > "$B/daemon.json.ABSENT"; fi
iptables-save > "$B/iptables-save.txt"
ip6tables-save > "$B/ip6tables-save.txt"
nft list ruleset > "$B/nft-ruleset.txt"
ufw status verbose > "$B/ufw-status.txt" 2>&1 || true
docker network ls > "$B/docker-networks.txt"
docker info --format '{{json .Runtimes}}' > "$B/docker-runtimes.json"
for c in $(docker ps -q); do docker inspect -f '{{.Name}} {{.State.StartedAt}}' "$c"; done > "$B/startedat.txt"
ls /etc/apt/sources.list.d/ > "$B/apt-sources.txt"
cat > "$B/RESTORE.md" <<EOF
# Restore after the office-runner install (backup taken $TS UTC)
Nothing here restarts dockerd or an existing container.
1. Apps off: /opt/office-runner/kill-all
2. Caddy (edit in place, same inode, then graceful reload):
     cat $B/Caddyfile > /opt/edge/Caddyfile && docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile
3. Runner: systemctl disable --now office-runner-edge office-runner
     docker rm -f \$(docker ps -aq --filter label=office.runner); umount /opt/office-runner/mnt/* ; docker network rm office-apps office-build
4. Firewall (own tables only; UFW/Docker rules were never changed, the saved copies are for reference):
     systemctl disable office-apps-firewall; nft delete table inet office_apps; nft delete table bridge office_apps_l2
5. Docker runtimes: $( [ -f /etc/docker/daemon.json ] && echo "cp $B/daemon.json /etc/docker/daemon.json" || echo "rm /etc/docker/daemon.json (it did not exist before)" ) && systemctl reload docker
6. gVisor: apt-get remove runsc; rm /etc/apt/sources.list.d/gvisor.list /usr/share/keyrings/gvisor-archive-keyring.gpg
Check after each step: curl -s -o /dev/null -w '%{http_code}' https://iscolinfree.com/ (and /theoffice/, https://sortmydog.com/) give 200,
and the StartedAt values in $B/startedat.txt are unchanged.
EOF
echo "$B"
