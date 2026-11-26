const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets', 'fonts');
const fonts = [
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'Inter.woff2'],
  ['@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2', 'GeistMono.woff2']
];

fs.mkdirSync(output, { recursive: true });
for (const [source, name] of fonts) {
  const input = path.join(root, 'node_modules', ...source.split('/'));
  fs.copyFileSync(input, path.join(output, name));
}
