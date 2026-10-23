#!/usr/bin/env bash
# Activation requires a separately provisioned release layout and PM2 config.
# Never reads, copies, prints, or replaces the production .env.
set -euo pipefail
umask 077
revision=${1:?full revision required}
expected=${2:?expected current revision required}
upload=${3:?upload directory required}
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$expected" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$upload" =~ ^/tmp/eclado-payment-[0-9]+-[0-9]+$ ]] || exit 2
root=${PAYMENT_RELEASE_ROOT:-/opt/eclado-payment-releases}
[[ "$root" = /* && "$root" != / ]] || exit 2
test -f "$root/READY" || { echo 'Release layout not provisioned; legacy deployment untouched.' >&2; exit 3; }
exec 9>"$root/deploy.lock"
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 4; }
previous=$(readlink -f "$root/current")
test "$previous" = "$root/releases/$expected" || { echo 'Active release changed; recheck before deployment.' >&2; exit 5; }
test -f "$root/ecosystem.config.cjs"
test -f "$root/shared/.env"
# Prevent accidental deletion or reuse of a previous immutable release.
release="$root/releases/$revision"
test ! -e "$release" || { echo 'Release already exists; use a new commit or the documented rollback procedure.' >&2; exit 6; }
cd "$upload"
sha256sum -c payment-api.tgz.sha256
contents=$(tar -tzf payment-api.tgz | LC_ALL=C sort)
allowed=$(printf '%s\n' assisted-orders.js checkout-events.cjs package-lock.json package.json reward-payment-evidence.cjs server.js sinopac-diagnostics.cjs sinopac-status-codes.json | LC_ALL=C sort)
test "$contents" = "$allowed" || { echo 'Unexpected runtime archive contents.' >&2; exit 7; }
test -z "$(tar -tvzf payment-api.tgz | cut -c1 | tr -d '\n-')" || { echo 'Archive must contain regular files only.' >&2; exit 7; }
mkdir "$release"
tar -xzf payment-api.tgz -C "$release" --no-same-owner --no-same-permissions
cd "$release"
npm ci --omit=dev --ignore-scripts
node --check server.js
node --check assisted-orders.js
node --check reward-payment-evidence.cjs
node --check checkout-events.cjs
node --check sinopac-diagnostics.cjs
node -e 'JSON.parse(require("node:fs").readFileSync("sinopac-status-codes.json","utf8"))'
ln -s "$root/shared/.env" "$release/.env"
health() {
  curl --fail --silent --max-time 3 http://127.0.0.1:3000/health |
    node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{const v=JSON.parse(s);process.exit(v.ok===true&&v.service==="eclado-payment-api"?0:1)}catch{process.exit(1)}})'
}
health || { echo 'Existing service is unhealthy; activation cancelled.' >&2; exit 8; }
switch_to() {
  ln -s "$1" "$root/current.next"
  mv -Tf "$root/current.next" "$root/current"
}
activated=false
rollback() {
  status=$?
  trap - EXIT
  if "$activated"; then
    switch_to "$previous"
    if pm2 startOrRestart "$root/ecosystem.config.cjs" --only eclado-payment-api >"$upload/rollback.log" 2>&1 && health; then
      pm2 save >"$upload/save.log" 2>&1
      echo 'Activation failed; prior release restored.' >&2
    else
      echo 'CRITICAL: activation and automatic recovery failed; operator intervention required.' >&2
    fi
  fi
  exit "$status"
}
trap rollback EXIT
# Rollback here is only for this activation, before any new DB migration.
activated=true
switch_to "$release"
pm2 startOrRestart "$root/ecosystem.config.cjs" --only eclado-payment-api >"$upload/activate.log" 2>&1
healthy=false
for attempt in {1..10}; do
  if health; then healthy=true; break; fi
  sleep 1
done
"$healthy" || exit 9
pid=$(pm2 pid eclado-payment-api)
[[ "$pid" =~ ^[0-9]+$ && "$pid" != 0 ]]
test "$(readlink -f "/proc/$pid/cwd")" = "$release"
pm2 save >"$upload/save.log" 2>&1
activated=false
trap - EXIT
echo "Payment API release active: $revision"
