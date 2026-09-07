import { cp, mkdir, readFile, rm } from 'node:fs/promises';
const report=JSON.parse(await readFile('mirror-report.json','utf8'));
if(!report.pages.length) throw new Error('No captured pages');
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('site','dist',{recursive:true});
console.log(`Built ${report.pages.length} pages with ${report.assets} presentation assets.`);
