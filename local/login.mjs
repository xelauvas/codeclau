#!/usr/bin/env node
// Xela Code sign-in with a XelaSphere account (device flow, like `claude login`).
//   node login.mjs [https://api.xelasphere.com]
// Prints progress on stderr and, on success, server.env lines on stdout:
//   XELA_SERVER_URL=..., LLAMA_API_KEY=..., XELA_USER=..., XELA_MODEL=...
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const server = (process.argv[2] || process.env.XELA_CLOUD_URL || 'https://api.xelasphere.com').replace(/\/+$/, '');
const log = (...a) => console.error(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  try {
    const res = await fetch(server + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'xela-code-login' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: 'network', error_description: e.message } };
  }
}

function openBrowser(url) {
  let isWSL = false;
  try { isWSL = process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch {}
  let cmd, args;
  if (process.env.BROWSER) { cmd = process.env.BROWSER; args = [url]; }
  else if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else if (isWSL) { cmd = 'powershell.exe'; args = ['-NoProfile', '-Command', `Start-Process '${url}'`]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
    return true;
  } catch { return false; }
}

const start = await post('/cli/device', { client: 'xela-code', hostname: os.hostname() });
if (start.status !== 200 || !start.data?.device_code) {
  const why = start.data?.error_description || start.data?.error || `HTTP ${start.status}`;
  log(`Could not start the sign-in at ${server}: ${why}`);
  process.exit(1);
}
const d = start.data;
log('');
log('  Sign in to XelaSphere to connect Xela Code.');
log('');
log(`  Open:  ${d.verification_uri_complete}`);
log(`  Code:  ${d.user_code}`);
log('');
const opened = process.env.XELA_NO_BROWSER ? false : openBrowser(d.verification_uri_complete);
log(opened ? '  Waiting for you to approve in the browser... (Ctrl+C to cancel)'
           : '  Open the link in a browser and approve... (Ctrl+C to cancel)');

const deadline = Date.now() + (d.expires_in || 900) * 1000;
let interval = Math.max(1, d.interval || 3) * 1000;
while (Date.now() < deadline) {
  await sleep(interval);
  const r = await post('/cli/token', { device_code: d.device_code });
  if (r.status === 200 && r.data?.api_key) {
    const t = r.data;
    log(`  Signed in as ${t.email || 'unknown user'}.`);
    log('');
    process.stdout.write(
      `XELA_SERVER_URL=${t.server || server}\nLLAMA_API_KEY=${t.api_key}\nXELA_USER=${t.email || ''}\nXELA_MODEL=${t.model || ''}\n`);
    process.exit(0);
  }
  if (r.status === 428 || r.status === 0) continue;      // pending / transient network error
  if (r.status === 429) { interval += 2000; continue; }  // slow down
  log(`  Sign-in failed: ${r.data?.error_description || r.data?.error || 'HTTP ' + r.status}`);
  process.exit(1);
}
log('  Sign-in timed out. Run the login again.');
process.exit(1);
