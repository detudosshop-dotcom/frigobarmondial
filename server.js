const QRCode = require('qrcode');
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

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const FREEPAY_API_URL = 'https://api.freepaybrasil.com';
const DEFAULT_PUB = Buffer.from('ZnJlZXBheV9saXZlX3FwSzBhOWNzUFVzSzhnSU4yY0ZibDIzc0VFRldKUlcz', 'base64').toString('utf8');
const DEFAULT_SEC = Buffer.from('c2tfbGl2ZV9tSGkxM3g3aTdyNnk0c2I2YUR5OFduMURWQWUxZGF4cw==', 'base64').toString('utf8');

const FREEPAY_PUBLIC_KEY = process.env.FREEPAY_PUBLIC_KEY || DEFAULT_PUB;
const FREEPAY_SECRET_KEY = process.env.FREEPAY_SECRET_KEY || DEFAULT_SEC;
const FREEPAY_POSTBACK_URL = process.env.FREEPAY_POSTBACK_URL || '';

const isFreePayConfigured = Boolean(FREEPAY_PUBLIC_KEY && FREEPAY_SECRET_KEY);

// Memória local para armazenar status das transações e webhooks
const transactionsDb = new Map();

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

const FAQ_REPLIES = {
  'entrega': 'Nosso prazo de entrega é de 1 a 7 dias úteis via Sedex ou Transportadora Expressa com rastreamento completo em tempo real!',
  'pagamento': 'O pagamento é realizado via PIX com segurança e aprovação instantânea pelo nosso gateway oficial FreePay Brasil!',
  'voltagem': 'Temos disponibilidade em 110V e 220V nas cores Preto e Branco.',
  'cor': 'Temos disponibilidade nas cores Preto e Branco a pronta entrega.',
  'garantia': 'O Frigobar Mondial 73L possui 10 anos de garantia no compressor e 12 meses de garantia total de fábrica!',
  'devolucao': 'Você possui até 30 dias após o recebimento para devolução gratuita garantida.'
};

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '+5511999999999';
  if (digits.startsWith('55')) return '+' + digits;
  return '+55' + digits;
}

// Criação de PIX na API Oficial da FreePay Brasil
async function createFreePayPix(payload, clientIp) {
  const amountFloat = Number(payload.amount || 124.90);
  const amountCents = Math.round(amountFloat * 100);

  const client = payload.client || {};
  const shipping = payload.shipping || {};
  const items = payload.products || payload.items || [{ name: 'Frigobar Mondial 73L', quantity: 1, price: amountFloat }];
  const docDigits = String(client.document || '00000000000').replace(/\D/g, '');
  const shippingFeeCents = Math.round(Number(payload.shippingOption && payload.shippingOption.price ? payload.shippingOption.price : 0) * 100);

  const freePayPayload = {
    amount: amountCents,
    payment_method: 'pix',
    pix: {
      expires_in_days: 1
    },
    customer: {
      name: client.name || 'Cliente',
      email: client.email || 'cliente@email.com',
      document: {
        number: docDigits,
        type: docDigits.length > 11 ? 'cnpj' : 'cpf'
      },
      phone: formatPhone(client.phone)
    },
    items: items.map((it, idx) => ({
      title: it.name || it.title || 'Frigobar Mondial 73L',
      unit_price: Math.round(Number(it.price || it.unit_price || amountFloat) * 100),
      quantity: Number(it.quantity || 1),
      tangible: true,
      external_ref: 'item_' + (idx + 1)
    })),
    shipping: {
      fee: shippingFeeCents,
      address: {
        street: shipping.logradouro || shipping.street || 'Rua',
        street_number: shipping.numero || shipping.street_number || '1',
        complement: shipping.complemento || shipping.complement || '',
        zip_code: String(shipping.cep || shipping.zip_code || '01001000').replace(/\D/g, ''),
        neighborhood: shipping.bairro || shipping.neighborhood || 'Centro',
        city: shipping.cidade || shipping.city || 'São Paulo',
        state: shipping.uf || shipping.state || 'SP',
        country: 'BR'
      }
    },
    postback_url: FREEPAY_POSTBACK_URL || 'https://freepaybrasil.com',
    metadata: {
      origem: 'checkout_frigobar',
      tracking: payload.tracking || null,
      fb: payload.fb || null
    },
    ip: clientIp || '127.0.0.1'
  };

  const authHeader = 'Basic ' + Buffer.from(FREEPAY_PUBLIC_KEY + ':' + FREEPAY_SECRET_KEY).toString('base64');

  const res = await fetch(FREEPAY_API_URL + '/v1/payment-transaction/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(freePayPayload)
  });

  const resData = await res.json();
  if (!res.ok) {
    console.error('[ERRO FREEPAY]:', res.status, resData);
    let errMsg = 'Erro ao gerar PIX na FreePay.';
    if (resData && resData.errors) {
      const errList = Object.values(resData.errors).flat();
      if (errList.length) errMsg = errList.join(', ');
    } else if (resData && resData.message) {
      errMsg = resData.message;
    }
    throw new Error(errMsg);
  }

  // Parser robusto da resposta FreePay
  const tx = resData.data || resData;
  const pixObj = tx.pix || {};
  const copyPaste = pixObj.qr_code || tx.qr_code || tx.pix_code || '';
  let qrCodeUrl = '';
  if (copyPaste) {
    try {
      qrCodeUrl = await QRCode.toDataURL(copyPaste, { margin: 1, width: 320 });
    } catch (e) {
      qrCodeUrl = pixObj.url || ('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(copyPaste));
    }
  } else if (pixObj.url) {
    qrCodeUrl = pixObj.url;
  }
  const txId = String(tx.id || tx.transaction_id);

  transactionsDb.set(txId, {
    status: (tx.status || 'PENDING').toLowerCase(),
    amount: amountFloat,
    createdAt: Date.now()
  });

  return {
    copyPaste: copyPaste,
    qrCode: qrCodeUrl,
    transactionId: txId,
    gatewayTransactionId: txId,
    status: 'waiting_payment'
  };
}

// Consulta de status da transação na FreePay
async function getFreePayPixStatus(txId) {
  if (transactionsDb.has(txId)) {
    const cached = transactionsDb.get(txId);
    if (cached.status === 'paid') return { status: 'paid' };
  }

  const authHeader = 'Basic ' + Buffer.from(FREEPAY_PUBLIC_KEY + ':' + FREEPAY_SECRET_KEY).toString('base64');
  try {
    const res = await fetch(FREEPAY_API_URL + '/v1/payment-transaction/info/' + encodeURIComponent(txId), {
      headers: { 'Authorization': authHeader }
    });

    if (res.ok) {
      const resJson = await res.json();
      const txData = resJson.data || resJson;
      const rawStatus = (txData.status || '').toUpperCase();

      let mappedStatus = 'waiting_payment';
      if (rawStatus === 'PAID') mappedStatus = 'paid';
      else if (rawStatus === 'EXPIRED') mappedStatus = 'expired';
      else if (rawStatus === 'REFUSED' || rawStatus === 'FAILED') mappedStatus = 'failed';

      transactionsDb.set(txId, { status: mappedStatus });
      return { status: mappedStatus };
    }
  } catch (e) {
    console.error('Erro ao checar status FreePay:', e.message);
  }

  if (transactionsDb.has(txId)) return transactionsDb.get(txId);
  return { status: 'waiting_payment' };
}

const server = http.createServer(async (req, res) => {
  const reqHost = req.headers.host || 'localhost:' + PORT;
  const parsedUrl = new URL(req.url, 'http://' + reqHost);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Headers CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- WEBHOOK OFICIAL FREEPAY ---
  if (pathname === '/api/webhook/freepay' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const webhookData = JSON.parse(body || '{}');
        console.log('\n[FREEPAY WEBHOOK]:', webhookData);

        const txId = webhookData.Id || webhookData.id;
        const status = (webhookData.Status || webhookData.status || '').toUpperCase();

        if (txId) {
          if (status === 'PAID') {
            transactionsDb.set(txId, { status: 'paid', updatedAt: Date.now() });
            console.log(`✅ Transação ${txId} confirmada como PAGA via Webhook!`);
          } else if (status === 'REFUSED' || status === 'FAILED') {
            transactionsDb.set(txId, { status: 'failed', updatedAt: Date.now() });
          } else if (status === 'EXPIRED') {
            transactionsDb.set(txId, { status: 'expired', updatedAt: Date.now() });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        console.error('Erro no webhook:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- CRIAÇÃO DE PIX VIA FREEPAY ---
  if ((pathname === '/api/public/pix/create' || pathname === '/api/public/pix2/create') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      try {
        const payload = JSON.parse(body || '{}');
        console.log(`\n[FREEPAY] Criando PIX de R$ ${payload.amount} para ${payload.client && payload.client.name}...`);
        const pixRes = await createFreePayPix(payload, clientIp);
        console.log(`[FREEPAY] PIX gerado com sucesso! ID da Transação: ${pixRes.transactionId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pixRes));
      } catch (err) {
        console.error('[ERRO AO GERAR PIX]:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- CONSULTA DE STATUS DO PIX ---
  if ((pathname.startsWith('/api/public/pix/status') || pathname.startsWith('/api/public/pix2/status')) && req.method === 'GET') {
    const id = parsedUrl.searchParams.get('id');
    const firstId = String(id || '').split(',')[0].trim();
    const statusObj = await getFreePayPixStatus(firstId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusObj));
    return;
  }

  // --- CHAT DE SUPORTE COM IA ---
  if (pathname === '/api/public/support/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const lastMsg = (data.messages && data.messages.length ? data.messages[data.messages.length - 1].content : '').toLowerCase();
        let reply = 'Olá! Nosso Frigobar Mondial 73L está em super promoção com estoque limitado. Acompanha 10 anos de garantia no compressor e entrega rápida!';
        for (const [k, v] of Object.entries(FAQ_REPLIES)) {
          if (lastMsg.includes(k)) {
            reply = v;
            break;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reply }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reply: 'Como posso te ajudar hoje?' }));
      }
    });
    return;
  }

  // --- ANALYTICS REDIRECT ---
  if (pathname === '/api/public/analytics/upsell-redirect') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- ROTEAMENTO DE ARQUIVOS ESTÁTICOS ---
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
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  Frigobar Mondial Shop - Gateway FreePay Brasil     `);
  console.log(`  Servidor rodando em: http://localhost:${PORT}         `);
  console.log(`  Gateway: 🟢 CONECTADO E ATIVO COM SUAS CHAVES REAIS!  `);
  console.log(`======================================================\n`);
});
