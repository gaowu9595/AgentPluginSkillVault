'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PUBLIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/task-model.js': ['task-model.js', 'text/javascript; charset=utf-8'],
  '/assets/mark.svg': ['assets/mark.svg', 'image/svg+xml'],
};

async function startDemoServer({ root = __dirname, mode = 'fixed' } = {}) {
  if (!['broken', 'fixed'].includes(mode)) throw new Error('Unknown app mode');
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const route = request.url.split('?')[0];
    try {
      let body;
      let contentType;
      if (route === '/app-mode.js') {
        body = Buffer.from(`globalThis.TASK_APP_MODE = ${JSON.stringify(mode)};\n`);
        contentType = 'text/javascript; charset=utf-8';
      } else {
        const file = Object.hasOwn(PUBLIC_FILES, route) && PUBLIC_FILES[route];
        if (!file) {
          response.writeHead(404);
          response.end();
          return;
        }
        body = await fs.readFile(path.join(root, file[0]));
        contentType = file[1];
      }
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(500);
      response.end('Demo asset unavailable');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

module.exports = { startDemoServer };
