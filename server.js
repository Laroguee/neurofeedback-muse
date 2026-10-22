/**
 * Servidor HTTP local para Neurofeedback Dashboard
 * Zero-Dependencies · Compatible con Windows y Unix
 * Ejecución: node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let cleanUrl = decodeURI(req.url.split('?')[0]);
  if (cleanUrl === '/' || cleanUrl === '') {
    cleanUrl = '/index.html';
  }

  // Quitar barra inicial para resolver paths de forma segura
  const relativePath = cleanUrl.replace(/^\/+/, '');

  // Buscar primero en la carpeta dashboard/, luego en la raíz
  let candidatePath = path.join(__dirname, 'dashboard', relativePath);
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
    candidatePath = path.join(__dirname, relativePath);
  }

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    const ext = path.extname(candidatePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(candidatePath).pipe(res);
    console.log(`[200] ${cleanUrl} -> ${path.relative(__dirname, candidatePath)}`);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404: No encontrado (${cleanUrl})`);
    console.log(`[404] ${cleanUrl}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🧠 Servidor Neurofeedback Resumen Activo`);
  console.log(`🔗 Dashboard: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
