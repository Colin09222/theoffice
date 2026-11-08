#!/bin/bash
# Installs gVisor's runsc from gVisor's apt repository and registers the runsc and runsc-build Docker
# runtimes by merging deploy/daemon.json into /etc/docker/daemon.json, then reloads dockerd with
# SIGHUP (`systemctl reload docker`). Runtimes are reloadable, so no container restarts.
# Run deploy/backup.sh first.
set -euo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1

if ! command -v runsc > /dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
  # Refresh only gVisor's list, and install only runsc.
  apt-get update -qq -o Dir::Etc::sourcelist=sources.list.d/gvisor.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
  apt-get install -s --no-install-recommends runsc | grep '^Inst'
  apt-get install -y -qq --no-install-recommends runsc > /dev/null
fi
runsc --version | head -1

# Merge the runtimes into daemon.json (it may not exist yet); keep every other setting.
python3 - "$SRC/deploy/daemon.json" <<'EOF'
import json, os, sys
path = '/etc/docker/daemon.json'
cur = json.load(open(path)) if os.path.exists(path) else {}
add = json.load(open(sys.argv[1]))
cur.setdefault('runtimes', {}).update(add['runtimes'])
tmp = path + '.office-runner.tmp'
with open(tmp, 'w') as f:
    json.dump(cur, f, indent=2)
    f.write('\n')
os.chmod(tmp, 0o644)
os.replace(tmp, path)
print('daemon.json runtimes:', ', '.join(sorted(cur['runtimes'])))
EOF
systemctl reload docker
sleep 2
docker info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}'
