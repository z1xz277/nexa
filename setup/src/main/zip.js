const crypto = require('node:crypto');
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const yauzl = require('yauzl');

function assertAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Operation cancelled.');
    error.name = 'CancelledError';
    throw error;
  }
}

async function sha256File(filePath, signal) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    assertAborted(signal);
    hash.update(chunk);
  }
  assertAborted(signal);
  return hash.digest('hex');
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      zip.on('error', (zipError) => reject(zipError));
      resolve(zip);
    });
  });
}

function resolveEntryPath(root, fileName) {
  const normalized = fileName.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || windowsReserved.test(part) || /[. ]$/.test(part))
  ) {
    throw new Error(`The payload contains an unsafe path: ${fileName}`);
  }

  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`The payload contains a path outside the install folder: ${fileName}`);
  }
  return target;
}

async function inspectZip(filePath, signal) {
  assertAborted(signal);
  const zip = await openZip(filePath);
  const entries = [];
  let totalBytes = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };

    zip.on('entry', (entry) => {
      try {
        assertAborted(signal);
        if (entry.encrypted) {
          throw new Error('The payload is encrypted and cannot be installed.');
        }
        const target = resolveEntryPath(path.parse(filePath).root, entry.fileName);
        entries.push({ entry, fileName: entry.fileName, target, uncompressedSize: entry.uncompressedSize });
        totalBytes += entry.uncompressedSize;
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zip.on('error', fail);
    zip.readEntry();
  });

  return { entries, totalBytes };
}

async function extractZip(filePath, destination, options = {}) {
  const { signal, onProgress } = options;
  assertAborted(signal);
  const inspected = await inspectZip(filePath, signal);
  const zip = await openZip(filePath);
  let extractedBytes = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };

    zip.on('entry', (entry) => {
      (async () => {
        assertAborted(signal);
        const target = resolveEntryPath(destination, entry.fileName);
        if (entry.fileName.endsWith('/')) {
          await fs.promises.mkdir(target, { recursive: true });
        } else {
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          await new Promise((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (streamError, readStream) => {
              if (streamError) {
                rejectStream(streamError);
                return;
              }
              const counter = new Transform({
                transform(chunk, encoding, callback) {
                  extractedBytes += chunk.length;
                  callback(null, chunk);
                }
              });
              pipeline(readStream, counter, fs.createWriteStream(target), { signal })
                .then(() => {
                  onProgress?.(extractedBytes, inspected.totalBytes, entry.fileName);
                  resolveStream();
                })
                .catch(rejectStream);
            });
          });
        }
        zip.readEntry();
      })().catch(fail);
    });

    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zip.on('error', fail);
    zip.readEntry();
  });

  return inspected;
}

module.exports = {
  assertAborted,
  extractZip,
  inspectZip,
  resolveEntryPath,
  sha256File
};
