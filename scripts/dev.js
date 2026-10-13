// Optional: serve ./public on http://localhost:8888 for testing before deploying (no dependencies).
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer((q, s) => {
  let f = path.join(root, path.normalize(decodeURIComponent(q.url.split('?')[0])));
  if (!f.startsWith(root)) { s.writeHead(403); return s.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(8888, () => console.log('http://localhost:8888'));
