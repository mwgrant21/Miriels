'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

// Personal files: seeded only on first run, never overwritten on update so the
// user's own data survives. Everything else bundled (the deck JSONs) is treated
// as app content and refreshed on every launch.
const PERSONAL_FILES = ['readers.json'];
// Never seed these: config.json holds the API key (not bundled at all) and
// readings.json is a legacy pre-profiles file the app no longer reads.
const SKIP_FILES = ['config.json', 'readings.json'];
// Writable subdirectories the server expects to exist.
const RUNTIME_DIRS = ['readings', 'profiles', 'patterns', 'daily'];

function getAppRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar')
    : path.join(__dirname, '..');
}

function seedUserData(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  for (const dir of RUNTIME_DIRS) {
    fs.mkdirSync(path.join(userDataDir, dir), { recursive: true });
  }

  const bundledData = path.join(getAppRoot(), 'data');

  // Seed EVERY bundled top-level *.json dynamically — so a new deck added to the
  // app ships and seeds automatically, with no hardcoded list to fall out of date.
  let bundled = [];
  try {
    bundled = fs.readdirSync(bundledData).filter(f => f.toLowerCase().endsWith('.json'));
  } catch (err) {
    console.error('[tarot] Could not read bundled data dir:', err.message);
  }

  for (const file of bundled) {
    if (SKIP_FILES.includes(file)) continue;
    const src = path.join(bundledData, file);
    const dst = path.join(userDataDir, file);
    // Personal files: only on first run. Decks/content: refresh every launch.
    if (PERSONAL_FILES.includes(file) && fs.existsSync(dst)) continue;
    try {
      fs.copyFileSync(src, dst);
    } catch (err) {
      console.error('[tarot] Failed to seed', file, err.message);
    }
  }
}

function findAvailablePort(preferred) {
  return new Promise((resolve, reject) => {
    let attempt = preferred;
    const tryPort = () => {
      if (attempt >= preferred + 10) {
        reject(new Error('No available port found in range ' + preferred + '-' + (preferred + 9)));
        return;
      }
      const srv = require('net').createServer();
      srv.once('error', () => { attempt++; tryPort(); });
      srv.once('listening', () => { srv.close(() => resolve(attempt)); });
      srv.listen(attempt, '127.0.0.1');
    };
    tryPort();
  });
}

function waitForServer(port, maxMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs;
    const check = () => {
      http.get('http://127.0.0.1:' + port + '/api/config-status', res => {
        if (res.statusCode === 200) { resolve(); }
        else { retry(); }
        res.resume();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) { reject(new Error('Server did not start in time')); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

async function createWindow() {
  const userDataDir = path.join(app.getPath('userData'), 'data');
  seedUserData(userDataDir);

  try {
    serverPort = await findAvailablePort(3000);
  } catch (err) {
    dialog.showErrorBox('Tarot & Oracle', 'Could not find an available port: ' + err.message);
    app.quit();
    return;
  }

  const serverPath = path.join(getAppRoot(), 'server.js');
  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(serverPort),
      DATA_DIR: userDataDir
    },
    silent: true
  });

  serverProcess.stdout.on('data', d => process.stdout.write('[server] ' + d));
  serverProcess.stderr.on('data', d => process.stderr.write('[server] ' + d));

  // Show loading window while server starts
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Tarot & Oracle',
    backgroundColor: '#0d0d1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const loadingPath = path.join(__dirname, 'loading.html');
  mainWindow.loadFile(loadingPath);

  try {
    await waitForServer(serverPort, 10000);
    mainWindow.loadURL('http://127.0.0.1:' + serverPort);
  } catch (err) {
    dialog.showErrorBox('Tarot & Oracle', 'The server failed to start: ' + err.message);
    app.quit();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
