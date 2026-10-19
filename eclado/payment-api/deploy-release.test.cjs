const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Real shell/filesystem/archive operations; only process manager, install and
// HTTP service are simulated. No production credentials, network or /opt writes.
const old = '1'.repeat(40), next = '2'.repeat(40);
function fixture(t, failure = '') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'payment-release-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'root'), bin = path.join(dir, 'bin');
  // Script constrains upload names to the same form used by Actions.
  const upload = `/tmp/eclado-payment-${process.pid}-${Math.floor(Math.random() * 1e8)}`;
  fs.mkdirSync(upload); t.after(() => fs.rmSync(upload, { recursive: true, force: true }));
  fs.mkdirSync(bin); fs.mkdirSync(`${root}/releases/${old}`, { recursive: true });
  fs.mkdirSync(`${root}/shared`); fs.writeFileSync(`${root}/shared/.env`, 'TEST_ONLY=true\n');
  fs.writeFileSync(`${root}/READY`, ''); fs.writeFileSync(`${root}/ecosystem.config.cjs`, '');
  fs.symlinkSync(`${root}/releases/${old}`, `${root}/current`);
  const write = (name, body) => fs.writeFileSync(`${bin}/${name}`, `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 });
  write('npm', 'exit 0');
  // Linux CI exercises real flock and mv -T. macOS lacks these Linux tools;
  // locally simulate only their platform mechanics, never production commands.
  if (process.platform !== 'linux') {
    write('flock', 'exit 0');
    write('mv', `node -e 'require("node:fs").renameSync(process.argv[1],process.argv[2])' "$2" "$3"`);
  }
  write('pm2', `echo "$*" >> "$PAYMENT_RELEASE_ROOT/pm2-calls"\nif [[ "$1" = pid ]]; then echo 123; fi`);
  write('readlink', `if [[ "$*" = *'/proc/123/cwd'* ]]; then /usr/bin/readlink -f "$PAYMENT_RELEASE_ROOT/current"; else /usr/bin/readlink "$@"; fi`);
  write('sleep', 'exit 0');
  write('curl', `active=$(/usr/bin/readlink -f "$PAYMENT_RELEASE_ROOT/current")\nif [[ "$TEST_FAILURE" = health && "$active" = *"/${next}" ]]; then exit 22; fi\nprintf '%s' '{"ok":true,"service":"eclado-payment-api"}'`);
  const source = `${dir}/source`; fs.mkdirSync(source);
  for (const file of ['server.js', 'assisted-orders.js', 'reward-payment-evidence.cjs']) fs.writeFileSync(`${source}/${file}`, '// fixture\n');
  fs.writeFileSync(`${source}/package.json`, '{}'); fs.writeFileSync(`${source}/package-lock.json`, '{}');
  assert.equal(spawnSync('tar', ['-czf', `${upload}/payment-api.tgz`, '-C', source, ...fs.readdirSync(source)]).status, 0);
  const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(`${upload}/payment-api.tgz`)).digest('hex');
  fs.writeFileSync(`${upload}/payment-api.tgz.sha256`, `${hash}  payment-api.tgz\n`);
  return { root, run(expected = old) {
    return spawnSync('bash', [path.join(__dirname, 'deploy-release.sh'), next, expected, upload], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PAYMENT_RELEASE_ROOT: root, TEST_FAILURE: failure },
    });
  } };
}
test('release requires an explicitly provisioned host and matching current revision', t => {
  const f = fixture(t);
  assert.equal(f.run('3'.repeat(40)).status, 5);
  assert.equal(fs.existsSync(`${f.root}/pm2-calls`), false);
  fs.unlinkSync(`${f.root}/READY`);
  assert.equal(f.run().status, 3);
});
test('complete runtime package activates and preserves the previous release and secret file', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.realpathSync(`${f.root}/current`), `${f.root}/releases/${next}`);
  assert.equal(fs.readFileSync(`${f.root}/shared/.env`, 'utf8'), 'TEST_ONLY=true\n');
  assert.ok(fs.existsSync(`${f.root}/releases/${old}`));
});
test('failed candidate health check restores prior release through PM2', t => {
  const f = fixture(t, 'health'), result = f.run();
  assert.equal(result.status, 9, result.stderr);
  assert.equal(fs.realpathSync(`${f.root}/current`), `${f.root}/releases/${old}`);
  const calls = fs.readFileSync(`${f.root}/pm2-calls`, 'utf8');
  assert.equal(calls.match(/startOrRestart/g).length, 2);
  assert.match(result.stderr, /prior release restored/);
});
