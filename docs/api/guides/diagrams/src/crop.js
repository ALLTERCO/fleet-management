const sharp=require('sharp');const fs=require('fs');
const svg=fs.readFileSync(process.argv[2]);
const [ox,oy,ow,oh,out]=process.argv.slice(3);
const D=3; // 3x density: svg unit -> 3px
sharp(svg,{density:72*D}).png().toBuffer().then(buf=>
  sharp(buf).extract({left:+ox*D,top:+oy*D,width:+ow*D,height:+oh*D}).toFile(out).then(()=>console.log('cropped',out))
);
