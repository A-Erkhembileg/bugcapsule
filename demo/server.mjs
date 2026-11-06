import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url));
createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
}).listen(4173, '127.0.0.1', () => console.log('ReproQuill demo: http://127.0.0.1:4173'));
