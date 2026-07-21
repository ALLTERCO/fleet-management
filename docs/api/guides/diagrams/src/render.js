const sharp = require('sharp');
const fs = require('fs');
const [,, svgPath, outPath, density] = process.argv;
sharp(fs.readFileSync(svgPath), { density: parseInt(density||'160',10) })
  .png().toFile(outPath)
  .then(i => console.log('rendered', outPath, i.width+'x'+i.height))
  .catch(e => { console.error(e); process.exit(1); });
