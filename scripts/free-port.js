#!/usr/bin/env node
/**
 * Frees the API port before boot.
 *
 * Windows keeps orphaned `node dist/src/main.js` processes alive after a
 * terminal is closed, which is the usual cause of `EADDRINUSE` on 3001.
 * This prestart guard removes only orphaned instances of *this* service
 * (nest CLI or a compiled dist entrypoint) and never unrelated servers
 * such as the frontend dev server.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 3001;
const SELF_PATTERN =
  /(dist[\\/](?:src[\\/])?main)|(@nestjs[\\/]cli)|((?:^|\s)nest(?:\.js)?(?:\s|$))/i;

function readPort() {
  if (process.env.PORT) return Number(process.env.PORT);

  const envPath = path.join(process.cwd(), '.env');
  try {
    const match = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (match) return Number(match[1]);
  } catch {
    /* no .env, fall through */
  }
  return DEFAULT_PORT;
}

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function listeningPids(port) {
  const pids = new Set();

  if (process.platform === 'win32') {
    for (const line of run('netstat', ['-ano']).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5 || !/LISTENING/i.test(cols[3] ?? '')) continue;
      if (!new RegExp(`:${port}$`).test(cols[1])) continue;
      if (/^\d+$/.test(cols[4])) pids.add(Number(cols[4]));
    }
  } else {
    for (const pid of run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).split(/\s+/)) {
      if (/^\d+$/.test(pid)) pids.add(Number(pid));
    }
  }

  return [...pids];
}

function processInfo(pid) {
  if (process.platform === 'win32') {
    // -EncodedCommand avoids all cmd/PowerShell quoting pitfalls on Windows.
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
      'if ($p) { @{ name = $p.Name; cmd = $p.CommandLine } | ConvertTo-Json -Compress }',
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const out = run('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]).trim();
    try {
      const parsed = JSON.parse(out);
      return { name: parsed.name ?? '', cmd: parsed.cmd ?? '' };
    } catch {
      return { name: '', cmd: '' };
    }
  }
  return {
    name: run('ps', ['-o', 'comm=', '-p', String(pid)]).trim(),
    cmd: run('ps', ['-o', 'command=', '-p', String(pid)]).trim(),
  };
}

function kill(pid) {
  if (process.platform === 'win32') {
    run('taskkill', ['/F', '/T', '/PID', String(pid)]);
  } else {
    run('kill', ['-9', String(pid)]);
  }
}

const port = readPort();
const pids = listeningPids(port);

if (pids.length === 0) {
  console.log(`[prestart] port ${port} is free`);
  process.exit(0);
}

for (const pid of pids) {
  const info = processInfo(pid);
  const isNode = /node(\.exe)?$/i.test(info.name);
  const isSelf = SELF_PATTERN.test(info.cmd);
  // If the command line is unreadable but the port is held by node, it is a
  // leftover instance of this service (the frontend runs on a different port).
  const unknownNode = isNode && !info.cmd;

  if (!isSelf && !unknownNode) {
    console.log(
      `[prestart] port ${port} is held by an unrelated process (pid ${pid}, ${info.name || 'unknown'}) — leaving it alone`,
    );
    continue;
  }

  console.log(`[prestart] killing stale API process on port ${port} (pid ${pid})`);
  kill(pid);
}

process.exit(0);
