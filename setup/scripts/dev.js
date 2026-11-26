const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electron = require('electron');
const child = spawn(electron, [root, '--dev'], { stdio: 'inherit', cwd: root });

child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
