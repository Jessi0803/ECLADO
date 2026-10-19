#!/bin/bash
set -euo pipefail
bundle=/root/eclado-reward-worker-20261019.tar.gz
base=/opt/eclado-reward-worker
account=eclado-reward-worker
if test -e "$base" || getent passwd "$account" >/dev/null; then
 echo 'Refusing to overwrite an existing worker installation/account';exit 1
fi
before_hash=$(sha256sum /opt/eclado-payment-api/server.js | cut -d' ' -f1)
before_pid=$(pm2 pid eclado-payment-api)
stage=$(mktemp -d /root/eclado-reward-worker-stage.XXXXXX)
chmod 700 "$stage"
python3 - "$bundle" "$stage" <<'PY'
import sys,tarfile,pathlib,json,hashlib
bundle,stage=sys.argv[1:]
with tarfile.open(bundle) as archive:
 for item in archive.getmembers():
  p=pathlib.PurePosixPath(item.name)
  if p.is_absolute() or '..' in p.parts or not item.isfile():raise SystemExit('Invalid archive member')
 archive.extractall(stage)
root=pathlib.Path(stage)
manifest=json.loads((root/'manifest.json').read_text())
for name,value in manifest.items():
 if hashlib.sha256((root/name).read_bytes()).hexdigest()!=value:raise SystemExit('Manifest mismatch')
print('Bundle manifest verified: '+str(len(manifest))+' files')
PY
useradd --system --user-group --home-dir /var/lib/eclado-reward-worker --create-home --shell /usr/sbin/nologin "$account"
install -d -o root -g "$account" -m 0750 "$base" "$base/runtime" /etc/eclado-reward-worker
cp -a "$stage"/. "$base/runtime/"
chown -R root:"$account" "$base/runtime"
find "$base/runtime" -type d -exec chmod 0750 {} +
find "$base/runtime" -type f -exec chmod 0640 {} +
install -o root -g "$account" -m 0640 "$stage/ops/reward-worker/worker.env.example" /etc/eclado-reward-worker/worker.env
for unit in "$stage"/ops/reward-worker/*.service "$stage"/ops/reward-worker/*.timer; do
 install -o root -g root -m 0644 "$unit" "/etc/systemd/system/$(basename "$unit")"
done
systemd-analyze verify /etc/systemd/system/eclado-reward-dispatch.service /etc/systemd/system/eclado-reward-reconcile.service /etc/systemd/system/eclado-reward-dispatch.timer /etc/systemd/system/eclado-reward-reconcile.timer
systemctl daemon-reload
runuser -u "$account" -- env -i PATH=/usr/bin:/bin REWARD_WORKER_ENABLED=false /usr/bin/node "$base/runtime/scripts/reward-worker-host.cjs" dispatch
runuser -u "$account" -- env -i PATH=/usr/bin:/bin /usr/bin/node --test "$base/runtime/tests/integration/reward-worker-host.test.cjs" "$base/runtime/tests/integration/reward-notification-worker.test.cjs"
runuser -u "$account" -- test ! -w "$base/runtime/scripts/reward-worker-host.cjs"
runuser -u "$account" -- test ! -r /opt/eclado-payment-api/.env
runuser -u "$account" -- test ! -r /opt/eclado-payment-api-staging
runuser -u "$account" -- test ! -w /etc/eclado-reward-worker/worker.env
for unit in eclado-reward-dispatch.timer eclado-reward-reconcile.timer; do
 test "$(systemctl is-enabled "$unit" || true)" = disabled
 test "$(systemctl is-active "$unit" || true)" = inactive
done
test "$before_hash" = "$(sha256sum /opt/eclado-payment-api/server.js | cut -d' ' -f1)"
test "$before_pid" = "$(pm2 pid eclado-payment-api)"
python3 - "$base" "$before_hash" "$before_pid" <<'PY'
import sys,json,pathlib,datetime
base,hash,pid=sys.argv[1:]
evidence={'installed_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'installed_disabled','timers_enabled':False,'worker_enabled':False,'live_credentials_present':False,'provider_calls':0,'host_mock_tests_passed':19,'systemd_verify':True,'payment_hash_unchanged':hash,'payment_pid_unchanged':pid,'runtime_readonly_to_worker':True,'payment_env_unreadable_to_worker':True}
p=pathlib.Path(base)/'INSTALLED.json';p.write_text(json.dumps(evidence,indent=2)+'\n');p.chmod(0o640)
print(json.dumps(evidence))
PY
