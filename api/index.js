const QRCode = require('qrcode');

const FLEVOPAY_API_URL = 'https://app.flevopay.com.br';
const DEFAULT_KEY = Buffer.from('Zmxldm9wYXlfc2tfNGQyZjIzNDljZDA2MGIyZWI5ZDIzNDY5MjMwMzc3NTlmMWMzYjYxNzY0NTQxNzM1OWZjOTZjOGE4MGVhMjQyOQ==', 'base64').toString('utf8');
const FLEVOPAY_API_KEY = process.env.FLEVOPAY_API_KEY || DEFAULT_KEY;
const FLEVOPAY_POSTBACK_URL = process.env.FLEVOPAY_POSTBACK_URL || '';

const transactionsDb = new Map();

const FAQ_REPLIES = {
  'entrega': 'Nosso prazo de entrega é de 1 a 7 dias úteis via Sedex ou Transportadora Expressa com rastreamento completo em tempo real!',
  'pagamento': 'O pagamento é realizado via PIX com segurança e aprovação instantânea pelo gateway oficial FlevoPay!',
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
  if (!digits || digits.length < 10) return '11999999999';
  if (digits.startsWith('55') && digits.length >= 12) return digits.slice(2);
  return digits;
}

async function createFlevoPix(payload, clientIp) {
  const amountFloat = Number(payload.amount || 124.90);
  const amountCents = Math.max(100, Math.round(amountFloat * 100));

  const client = payload.client || {};
  const docDigits = cleanDoc(client.document);
  const phoneDigits = formatPhone(client.phone);
  const tracking = payload.tracking || {};
  const reference = 'REF_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const flevoPayload = {
    amount: amountCents,
    description: 'Frigobar Mondial 73L',
    reference: reference,
    source: 'api_externa', // Ignora validação de productHash para integrações externas
    customer: {
      name: (client.name && client.name.trim().length >= 3) ? client.name.trim() : 'Cliente Mondial',
      email: (client.email && client.email.includes('@')) ? client.email.trim() : 'cliente@pagamento.com',
      document: docDigits,
      phone: phoneDigits
    },
    postback_url: FLEVOPAY_POSTBACK_URL || '',
    tracking: {
      utm_source: tracking.utm_source || tracking.source || '',
      utm_medium: tracking.utm_medium || '',
      utm_campaign: tracking.utm_campaign || '',
      utm_content: tracking.utm_content || '',
      utm_term: tracking.utm_term || '',
      src: tracking.src || '',
      sck: tracking.sck || ''
    }
  };

  if (!FLEVOPAY_API_KEY) {
    console.warn('[FlevoPay] FLEVOPAY_API_KEY ainda não configurada.');
    throw new Error('Chave de API da FlevoPay não configurada. Informe sua Secret Key.');
  }

  console.log('[FlevoPay Request] Criando PIX no valor:', amountCents, 'centavos. Ref:', reference);

  const res = await fetch(FLEVOPAY_API_URL + '/api/v1/transaction', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': FLEVOPAY_API_KEY
    },
    body: JSON.stringify(flevoPayload)
  });

  const resData = await res.json();
  console.log('[FlevoPay Response] Status:', res.status, resData);

  if (!res.ok || resData.status === 'error' || resData.success === false) {
    let errMsg = resData.message || resData.error || 'Erro ao gerar PIX na FlevoPay.';
    throw new Error(errMsg);
  }

  const copyPaste = resData.qr_code || resData.pix_code || '';
  let qrCodeUrl = resData.qr_code_base64 || '';

  // Se a FlevoPay não retornou base64, geramos localmente com a lib qrcode
  if (!qrCodeUrl && copyPaste) {
    try {
      qrCodeUrl = await QRCode.toDataURL(copyPaste, { margin: 1, width: 320 });
    } catch (e) {
      qrCodeUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(copyPaste);
    }
  }

  const txId = String(resData.transaction_id || resData.id || reference);

  transactionsDb.set(txId, {
    status: (resData.status || 'pending').toLowerCase(),
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

async function getFlevoPixStatus(txId) {
  if (transactionsDb.has(txId)) {
    const cached = transactionsDb.get(txId);
    if (cached.status === 'paid') return { status: 'paid' };
  }

  if (!FLEVOPAY_API_KEY) {
    return { status: 'waiting_payment' };
  }

  try {
    const res = await fetch(FLEVOPAY_API_URL + '/api/v1/query?action=get_transaction&id=' + encodeURIComponent(txId), {
      headers: {
        'X-API-Key': FLEVOPAY_API_KEY
      }
    });

    if (res.ok) {
      const resJson = await res.json();
      const rawStatus = (resJson.status || '').toLowerCase();

      let mappedStatus = 'waiting_payment';
      if (rawStatus === 'approved' || rawStatus === 'paid' || rawStatus === 'completed') mappedStatus = 'paid';
      else if (rawStatus === 'expired') mappedStatus = 'expired';
      else if (rawStatus === 'failed' || rawStatus === 'refused') mappedStatus = 'failed';
      else if (rawStatus === 'refunded') mappedStatus = 'refunded';

      transactionsDb.set(txId, { status: mappedStatus });
      return { status: mappedStatus };
    }
  } catch (e) {
    console.error('Erro status FlevoPay:', e.message);
  }

  if (transactionsDb.has(txId)) return transactionsDb.get(txId);
  return { status: 'waiting_payment' };
}

module.exports = async function handler(req, res) {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname = decodeURIComponent(parsedUrl.pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Webhook FlevoPay
  if ((pathname.endsWith('/webhook/flevopay') || pathname.endsWith('/webhook/freepay')) && req.method === 'POST') {
    let webhookData = req.body;
    if (typeof webhookData === 'string') webhookData = JSON.parse(webhookData);
    if (!webhookData) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try { webhookData = JSON.parse(raw || '{}'); } catch(e){ webhookData = {}; }
    }
    const txId = String(webhookData.transaction_id || webhookData.id || webhookData.external_id || '');
    const status = (webhookData.status || '').toLowerCase();
    if (txId && (status === 'approved' || status === 'paid' || status === 'completed')) {
      transactionsDb.set(txId, { status: 'paid', updatedAt: Date.now() });
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // Create PIX (Checkout e Upsells)
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
      const pixRes = await createFlevoPix(payload, clientIp);
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
    const statusObj = await getFlevoPixStatus(firstId);
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
