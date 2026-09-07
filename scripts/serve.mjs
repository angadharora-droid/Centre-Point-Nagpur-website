import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.env.STATIC_DIRECTORY || 'site');
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp4':'video/mp4','.gif':'image/gif'};
http.createServer(async(req,res)=>{try{let p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)&&p!==root)throw Error();if((await stat(p)).isDirectory())p=path.join(p,'index.html');const b=await readFile(p);res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404,{'Content-Type':'text/html'});res.end('<h1>Page not found</h1><a href="/">Return home</a>');}}).listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));
