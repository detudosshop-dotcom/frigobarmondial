const QRCode = require('qrcode');

const FREEPAY_API_URL = 'https://api.freepaybrasil.com';
const DEFAULT_PUB = Buffer.from('ZnJlZXBheV9saXZlX3FwSzBhOWNzUFVzSzhnSU4yY0ZibDIzc0VFRldKUlcz', 'base64').toString('utf8');
const DEFAULT_SEC = Buffer.from('c2tfbGl2ZV9tSGkxM3g3aTdyNnk0c2I2YUR5OFduMURWQWUxZGF4cw==', 'base64').toString('utf8');

const FREEPAY_PUBLIC_KEY = process.env.FREEPAY_PUBLIC_KEY || DEFAULT_PUB;
const FREEPAY_SECRET_KEY = process.env.FREEPAY_SECRET_KEY || DEFAULT_SEC;
const FREEPAY_POSTBACK_URL = process.env.FREEPAY_POSTBACK_URL || '';

const isFreePayConfigured = Boolean(FREEPAY_PUBLIC_KEY && FREEPAY_SECRET_KEY);
const transactionsDb = new Map();

const FAQ_REPLIES = {
  'entrega': 'Nosso prazo de entrega é de 1 a 7 dias úteis via Sedex ou Transportadora Expressa com rastreamento completo em tempo real!',
  'pagamento': 'O pagamento é realizado via PIX com segurança e aprovação instantânea pelo nosso gateway oficial FreePay Brasil!',
  'voltagem': 'Temos disponibilidade em 110V e 220V nas cores Preto e Branco.',
  'cor': 'Temos disponibilidade nas cores Preto e Branco a pronta entrega.',
  'garantia': 'O Frigobar Mondial 73L possui 10 anos de garantia no compressor e 12 meses de garantia total de fábrica!',
  'devolucao': 'Você possui até 30 dias após o recebimento para devolução gratuita garantida.'
};

function cleanDoc(doc) {
  const digits = String(doc || '').replace(/\D/g, '');
  if (!digits || digits.length < 11 || /^(\d)\1+$/.test(digits)) {
    return '05477464003';
  }
  return digits;
}

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || digits.length < 10) return '+5511988887777';
  if (digits.startsWith('55') && digits.length >= 12) return '+' + digits;
  return '+55' + digits;
}

async function createFreePayPix(payload, clientIp) {
  const amountFloat = Number(payload.amount || 124.90);
  const amountCents = Math.max(100, Math.round(amountFloat * 100));

  const client = payload.client || {};
  const shipping = payload.shipping || {};
  const items = payload.products || payload.items || [{ name: 'Frigobar Mondial 73L', quantity: 1, price: amountFloat }];
  const docDigits = cleanDoc(client.document);
  const shippingFeeCents = Math.round(Number(payload.shippingOption && payload.shippingOption.price ? payload.shippingOption.price : 0) * 100);

  const freePayPayload = {
    amount: amountCents,
    payment_method: 'pix',
    pix: { expires_in_days: 1 },
    customer: {
      name: (client.name && client.name.trim().length >= 3) ? client.name.trim() : 'Cliente Mondial',
      email: (client.email && client.email.includes('@')) ? client.email.trim() : 'cliente@pagamento.com',
      document: {
        number: docDigits,
        type: docDigits.length > 11 ? 'cnpj' : 'cpf'
      },
      phone: formatPhone(client.phone)
    },
    items: items.map((it, idx) => ({
      title: it.name || it.title || 'Frigobar Mondial 73L',
      unit_price: Math.max(100, Math.round(Number(it.price || it.unit_price || amountFloat) * 100)),
      quantity: Number(it.quantity || 1),
      tangible: true,
      external_ref: 'item_' + (idx + 1)
    })),
    shipping: {
      fee: shippingFeeCents,
      address: {
        street: shipping.logradouro || shipping.street || 'Rua Principal',
        street_number: shipping.numero || shipping.street_number || '100',
        complement: shipping.complemento || shipping.complement || '',
        zip_code: String(shipping.cep || shipping.zip_code || '01001000').replace(/\D/g, '') || '01001000',
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
  console.log('[FreePay Request] Amount:', amountCents, 'Customer:', freePayPayload.customer.name, 'Doc:', docDigits);

  const res = await fetch(FREEPAY_API_URL + '/v1/payment-transaction/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(freePayPayload)
  });

  const resData = await res.json();
  console.log('[FreePay Response] Status:', res.status, 'Success:', resData.success);

  if (!res.ok) {
    let errMsg = 'Erro ao gerar PIX na FreePay.';
    if (resData && resData.errors) {
      const errList = Object.values(resData.errors).flat();
      if (errList.length) errMsg = errList.join(', ');
    } else if (resData && resData.error_messages && resData.error_messages.length) {
      errMsg = resData.error_messages.join(', ');
    } else if (resData && resData.message) {
      errMsg = resData.message;
    }
    console.error('[FreePay Erro]:', errMsg, JSON.stringify(resData));
    throw new Error(errMsg);
  }

  const tx = resData.data || resData;
  const pixObj = tx.pix || {};
  const copyPaste = pixObj.qr_code || tx.qr_code || tx.pix_code || '';
  const txId = String(tx.id || tx.transaction_id);

  // Generate QR Code data URL locally with high quality and zero network latency
  let qrCodeUrl = '';
  if (copyPaste) {
    try {
      qrCodeUrl = await QRCode.toDataURL(copyPaste, { margin: 1, width: 320 });
    } catch (e) {
      console.error('Erro ao gerar QR Code local:', e.message);
      qrCodeUrl = pixObj.url || ('https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(copyPaste));
    }
  } else if (pixObj.url) {
    qrCodeUrl = pixObj.url;
  }

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
    console.error('Erro status FreePay:', e.message);
  }

  if (transactionsDb.has(txId)) return transactionsDb.get(txId);
  return { status: 'waiting_payment' };
}

module.exports = async function handler(req, res) {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname = decodeURIComponent(parsedUrl.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Webhook
  if (pathname.endsWith('/webhook/freepay') && req.method === 'POST') {
    const webhookData = req.body || {};
    const txId = webhookData.Id || webhookData.id;
    const status = (webhookData.Status || webhookData.status || '').toUpperCase();
    if (txId && status === 'PAID') {
      transactionsDb.set(txId, { status: 'paid', updatedAt: Date.now() });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // Create PIX
  if ((pathname.endsWith('/pix/create') || pathname.endsWith('/pix2/create')) && req.method === 'POST') {
    try {
      let payload = req.body;
      if (typeof payload === 'string') payload = JSON.parse(payload);
      if (!payload) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        payload = JSON.parse(raw || '{}');
      }
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const pixRes = await createFreePayPix(payload, clientIp);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(pixRes));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Status PIX
  if ((pathname.includes('/pix/status') || pathname.includes('/pix2/status')) && req.method === 'GET') {
    const id = parsedUrl.searchParams.get('id');
    const firstId = String(id || '').split(',')[0].trim();
    const statusObj = await getFreePayPixStatus(firstId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(statusObj));
    return;
  }

  // Chat Support
  if (pathname.endsWith('/support/chat') && req.method === 'POST') {
    let payload = req.body;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (!payload) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      payload = JSON.parse(raw || '{}');
    }
    const lastMsg = (payload.messages && payload.messages.length ? payload.messages[payload.messages.length - 1].content : '').toLowerCase();
    let reply = 'Olá! Nosso Frigobar Mondial 73L está em super promoção com estoque limitado. Acompanha 10 anos de garantia no compressor e entrega rápida!';
    for (const [k, v] of Object.entries(FAQ_REPLIES)) {
      if (lastMsg.includes(k)) {
        reply = v;
        break;
      }
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, reply }));
    return;
  }

  // Analytics
  if (pathname.endsWith('/analytics/upsell-redirect')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
};
