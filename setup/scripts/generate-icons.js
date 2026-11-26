const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const toIco = require('png-to-ico').default;

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
const assets = path.join(root, 'assets');
const source = fs.readFileSync(path.join(root, 'leaf.svg'));
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function createIcns(images) {
  const types = new Map([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]);
  const chunks = [];
  for (const [size, type] of types) {
    const image = images.get(size);
    if (!image) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(image.length + 8, 4);
    chunks.push(header, image);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

async function render(color, size) {
  const svg = source.toString().replaceAll('#000', color);
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

async function main() {
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(assets, { recursive: true });

  const black = [];
  const white = [];
  const blackBySize = new Map();
  for (const size of sizes) {
    const image = await render('#000', size);
    black.push(image);
    blackBySize.set(size, image);
    white.push(await render('#FFF', size));
  }

  const ico = await toIco(black.filter((image, index) => [16, 24, 32, 48, 64, 128, 256].includes(sizes[index])));
  const icns = createIcns(blackBySize);
  fs.writeFileSync(path.join(build, 'icon.png'), blackBySize.get(512));
  fs.writeFileSync(path.join(build, 'icon.ico'), ico);
  fs.writeFileSync(path.join(build, 'icon.icns'), icns);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);
  fs.writeFileSync(path.join(assets, 'icon.icns'), icns);
  fs.writeFileSync(path.join(assets, 'leaf-white.svg'), source.toString().replaceAll('#000', '#FFF'));
  fs.writeFileSync(path.join(assets, 'leaf-white.png'), white[sizes.indexOf(512)]);
  fs.writeFileSync(path.join(assets, 'leaf-black.png'), blackBySize.get(512));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
