const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const logPath = path.join(os.tmpdir(), 'nexa-setup.log');

function write(level, message) {
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // Logging must never block setup.
  }
}

module.exports = {
  logPath,
  info(message) {
    write('INFO', message);
  },
  warn(message) {
    write('WARN', message);
  },
  error(message) {
    write('ERROR', message);
  }
};
