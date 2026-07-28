const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const srcImage = 'C:\\Users\\LUMEN GLOBAL\\.gemini\\antigravity\\brain\\a38b3866-520c-4c2f-9b73-46e67fbda85f\\smartstock_icon_1785261733930.jpg';
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function run() {
  for (const size of sizes) {
    await sharp(srcImage)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);
  }
  console.log('\nAll icons generated in public/icons/');
}

run().catch(err => { console.error(err); process.exit(1); });
