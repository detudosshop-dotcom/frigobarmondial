const http = require('http');
const fs = require('fs');
const path = require('path');

// Carregador simples de variáveis de ambiente (.env)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const apiHandler = require('./api/index.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // Delega todas as requisições de API diretamente para o handler oficial
  if (pathname.startsWith('/api/')) {
    return apiHandler(req, res);
  }

  // Roteamento de arquivos estáticos (prioriza public/, depois root)
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (pathname === '/' || pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
      filePath = path.join(filePath, 'index.html');
    }
  }

  if (!fs.existsSync(filePath)) {
    // Fallback para ROOT_DIR
    let rootFilePath = path.join(ROOT_DIR, pathname);
    if (pathname === '/' || pathname === '') {
      rootFilePath = path.join(ROOT_DIR, 'index.html');
    } else if (!path.extname(rootFilePath)) {
      if (fs.existsSync(rootFilePath + '.html')) {
        rootFilePath = rootFilePath + '.html';
      } else if (fs.existsSync(path.join(rootFilePath, 'index.html'))) {
        rootFilePath = path.join(rootFilePath, 'index.html');
      }
    }
    if (fs.existsSync(rootFilePath)) {
      filePath = rootFilePath;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (req.headers.accept && req.headers.accept.includes('text/html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(path.join(PUBLIC_DIR, 'index.html')).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  const isFlevoConfigured = Boolean(process.env.FLEVOPAY_API_KEY);
  console.log(`\n======================================================`);
  console.log(`  Frigobar Mondial Shop - Gateway FlevoPay           `);
  console.log(`  Servidor rodando em: http://localhost:${PORT}         `);
  console.log(`  Gateway: ${isFlevoConfigured ? '🟢 FLEVOPAY ATIVA!' : '🟡 AGUARDANDO FLEVOPAY_API_KEY NO .env'}  `);
  console.log(`======================================================\n`);
});
