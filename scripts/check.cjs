const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = require('./files.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and extension versions must match');
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(fs.readdirSync(path.join(root, 'extension')).sort(), [...files].sort(), 'Unexpected extension files');
for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(script => script.js)]) {
  assert.ok(files.includes(file), 'Missing manifest entry: ' + file);
}
const rules = [
  ['API credential', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Personal Windows path', /[A-Z]:[\\/]Users[\\/][^\s"'<>]+/i]
];
let checked = 0;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'Symlinks are not expected in the public source');
    if (entry.isDirectory()) { inspect(file); continue; }
    const relative = path.relative(root, file);
    assert.ok(!/诊断|homework-live-|\.env(?:\.|$)|\.(?:zip|pem|key|log)$/i.test(entry.name), 'Private artifact: ' + relative);
    const text = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of rules) assert.ok(!pattern.test(text), label + ' detected in ' + relative);
    if (/\.(?:js|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw Error('Syntax check failed: ' + relative);
    }
    checked++;
  }
}
inspect(root);
console.log(`Checked ${checked} public files; manifest and syntax valid; no configured credential patterns found.`);
