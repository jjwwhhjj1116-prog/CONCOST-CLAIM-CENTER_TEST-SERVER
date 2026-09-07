import http from 'node:http';
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const allowed=new Set(['cf114-report.pdf','cf114-report.docx','cf114-report.hwpx','export-results.json']);
await mkdir(fileURLToPath(new URL('../artifacts/cf114/',import.meta.url)),{recursive:true});
http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3020');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const name=(req.url??'').slice(1);
  if(req.method!=='POST'||!allowed.has(name)||req.headers.origin!=='http://127.0.0.1:3020'){res.writeHead(403);res.end();return;}
  try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>20_000_000)throw Error('too large');chunks.push(chunk);}
    await writeFile(fileURLToPath(new URL(`../artifacts/cf114/${name}`,import.meta.url)),Buffer.concat(chunks));console.log(`${name}: ${size} bytes`);res.writeHead(201);res.end('saved');
  }catch(error){res.writeHead(400);res.end(String(error));}
}).listen(3021,'127.0.0.1',()=>console.log('CF114 artifact receiver 3021'));
