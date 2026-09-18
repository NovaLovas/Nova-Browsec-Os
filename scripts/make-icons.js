/* make-icons.js — из assets/icon.png делает .ico, PNG-набор для Linux и .iconset для macOS. */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'assets', 'icon.png');
const OUT  = path.join(ROOT, 'assets');

function have(mod) {
  try { require.resolve(mod); return true; } catch { return false; }
}

function need(mod, hint) {
  if (have(mod)) return;
  console.error(`\n✗ Не хватает пакета "${mod}".`);
  console.error(`  Установи: npm i -D ${hint || mod}\n`);
  process.exit(1);
}

need('sharp',      'sharp');
need('png-to-ico', 'png-to-ico');

const sharp = require('sharp');
const pngToIco = require('png-to-ico');

async function ensureSource() {
  if (!fs.existsSync(SRC)) {
    console.error(`\n✗ Нет файла: ${path.relative(ROOT, SRC)}`);
    console.error('  Положи квадратную PNG-иконку 1024×1024 в assets/icon.png');
    console.error('  Можно сгенерировать из assets/icon-source.svg:');
    console.error('    npx sharp-cli -i assets/icon-source.svg -o assets/icon.png resize 1024 1024\n');
    process.exit(1);
  }
  const meta = await sharp(SRC).metadata();
  console.log(`✓ Источник: ${path.relative(ROOT, SRC)} — ${meta.width}×${meta.height}`);
  if (meta.width !== meta.height) {
    console.error('✗ Иконка должна быть квадратной');
    process.exit(1);
  }
  if (meta.width < 512) {
    console.error('✗ Минимум 512×512, лучше 1024×1024');
    process.exit(1);
  }
}

async function makePngSet() {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const dir = path.join(OUT, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of sizes) {
    const target = path.join(dir, `${s}x${s}.png`);
    await sharp(SRC).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toFile(target);
    console.log(`  → assets/icons/${s}x${s}.png`);
  }
  // Основной PNG для Linux-категории
  await sharp(SRC).resize(512, 512).png().toFile(path.join(OUT, 'icon-512.png'));
  console.log(`  → assets/icon-512.png`);
}

async function makeIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map((s) => sharp(SRC)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer())
  );
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
  console.log(`  → assets/icon.ico (${sizes.join(', ')} px)`);
}

async function makeIcnsSet() {
  // Набор PNG для macOS, чтобы в дальнейшем iconutil собрал .icns
  const dir = path.join(OUT, 'icon.iconset');
  fs.mkdirSync(dir, { recursive: true });
  const map = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of map) {
    await sharp(SRC).resize(size, size).png().toFile(path.join(dir, name));
  }
  console.log(`  → assets/icon.iconset/ (10 файлов)`);

  // Если мы на macOS — сразу соберём .icns
  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns "${dir}" -o "${path.join(OUT, 'icon.icns')}"`, { stdio: 'inherit' });
      console.log(`  → assets/icon.icns`);
    } catch (e) {
      console.warn(`  ! iconutil не сработал: ${e.message}`);
      console.warn(`    Собери вручную: iconutil -c icns assets/icon.iconset -o assets/icon.icns`);
    }
  } else {
    console.log(`  i Для .icns нужен macOS: iconutil -c icns assets/icon.iconset -o assets/icon.icns`);
  }
}

(async () => {
  console.log('\nNovaOS — генерация иконок\n');
  await ensureSource();

  console.log('\n▸ PNG-наборы для Linux:');
  await makePngSet();

  console.log('\n▸ Windows .ico:');
  await makeIco();

  console.log('\n▸ macOS .iconset:');
  await makeIcnsSet();

  console.log('\n✓ Готово. Дальше:');
  console.log('    npm run build:win    — .exe установщик + portable');
  console.log('    npm run build:linux  — .AppImage + .deb');
  console.log('    npm run build:mac    — .dmg (только на macOS)\n');
})().catch((e) => {
  console.error('\n✗ Ошибка:', e.message);
  console.error(e.stack);
  process.exit(1);
});