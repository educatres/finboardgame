import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const assets=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/game.js', ['game.js','text/javascript; charset=utf-8']]
]);
const port=4173;

createServer(async(req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  let path;
  try{path=new URL(req.url,'http://127.0.0.1').pathname}catch{res.writeHead(400);res.end();return}
  const asset=assets.get(path);
  if(!asset){res.writeHead(404);res.end();return}
  try{
    const body=await readFile(new URL(asset[0],import.meta.url));
    res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(500);res.end()}
}).listen(port,'127.0.0.1',()=>console.log(`經濟棋局：http://127.0.0.1:${port}/`));
