// Exercise the actual archive in isolation, without the checkout's .env or
// node_modules. Only local health/invalid-input requests are sent; no payments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

async function verify(archive) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-runtime-'));
  let child;
  let output = '';
  try {
    const extracted = spawnSync('tar', ['-xzf', path.resolve(archive), '-C', directory], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    const installed = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: directory, encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(installed.status, 0, installed.stderr || installed.error?.message);

    const socket = net.createServer();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', resolve);
    });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, ['server.js'], {
      cwd: directory,
      env: {
        PATH: process.env.PATH, PORT: String(port), NODE_ENV: 'test',
        ORDER_CLEANUP_KEY: 'package-smoke-test-only',
        PAYMENT_NOTIFY_SECRET: 'package-smoke-test-only',
        GUEST_LOOKUP_SECRET: 'package-smoke-test-only',
        SUPABASE_URL: 'http://127.0.0.1:1',
        SINOPAC_API_BASE_URL: 'http://127.0.0.1:1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    const origin = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Packaged server exited: ${output}`);
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) });
        assert.equal(response.status, 200);
        const health = await response.json();
        assert.equal(health.ok, true);
        assert.equal(health.service, 'eclado-payment-api');
        healthy = true;
        break;
      } catch { await delay(100); }
    }
    assert.ok(healthy, `Packaged server did not become healthy: ${output}`);
    for (const action of ['start', 'status']) {
      const response = await fetch(`${origin}/api/courses/payment/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(response.status, 400, `Course payment ${action} route missing`);
      assert.equal((await response.json()).error, '課程訂單編號有誤');
    }
    console.log('Packaged runtime passed: server startup, /health, course payment start/status routes.');
  } finally {
    if (child && child.exitCode === null && child.pid) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (!process.argv[2]) {
  console.error('Usage: node verify-release.cjs /path/to/payment-api.tgz');
  process.exitCode = 1;
} else {
  verify(process.argv[2]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
