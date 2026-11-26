const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yazl = require('yazl');

const root = path.resolve(__dirname, '..');

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--name' || arg === '--version' || arg === '--exe' || arg === '--output') {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg === '--dev') {
      options.dev = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options._.push(arg);
    }
  }
  return options;
}

function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target, base));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function findExecutable(files, base, requested) {
  if (requested) {
    const normalized = requested.replaceAll('\\', '/').replace(/^\.\//, '');
    const target = path.resolve(base, normalized);
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`The executable was not found in the build folder: ${requested}`);
    }
    return relative.split(path.sep).join('/');
  }

  const executables = files.filter((file) => path.extname(file).toLowerCase() === '.exe');
  const preferred = executables.filter((file) => /^nexa(?:setup)?\.exe$/i.test(path.basename(file)));
  const candidates = preferred.length > 0 ? preferred : executables;
  if (candidates.length !== 1) {
    throw new Error('The build folder must contain one .exe, or pass --exe with the relative executable path.');
  }
  return path.relative(base, candidates[0]).split(path.sep).join('/');
}

function createZip(files, base, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const zip = new yazl.ZipFile();
    output.on('error', reject);
    output.on('close', resolve);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    for (const file of files) {
      zip.addFile(file, path.relative(base, file).split(path.sep).join('/'));
    }
    zip.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(args._[0] || '.');
  if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) {
    throw new Error(`Build folder not found: ${input}`);
  }

  const files = listFiles(input);
  if (files.length === 0) throw new Error('The build folder is empty.');
  const exe = findExecutable(files, input, args.exe);
  const outputDir = path.resolve(args.output || path.join(root, 'payload'));
  fs.mkdirSync(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, 'nexa-harness.zip');
  await createZip(files, input, archivePath);

  const buffer = fs.readFileSync(archivePath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const metadata = {
    name: args.name || 'Nexa',
    version: args.version || process.env.npm_package_version || packageInfo.version,
    sha256,
    sizeBytes: buffer.length,
    exe,
    devMode: Boolean(args.dev)
  };
  fs.writeFileSync(path.join(outputDir, 'payload.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Payload written to ${archivePath}`);
  console.log(`Executable: ${exe}`);
  console.log(`SHA-256: ${sha256}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
