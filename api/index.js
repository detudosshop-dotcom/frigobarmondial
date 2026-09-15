const QRCode = require('qrcode');

const FLEVOPAY_API_URL = 'https://app.flevopay.com.br';
const DEFAULT_FLEVOPAY_KEY = Buffer.from('Zmxldm9wYXlfc2tfNGQyZjIzNDljZDA2MGIyZWI5ZDIzNDY5MjMwMzc3NTlmMWMzYjYxNzY0NTQxNzM1OWZjOTZjOGE4MGVhMjQyOQ==', 'base64').toString('utf8');
const FLEVOPAY_API_KEY = process.env.FLEVOPAY_API_KEY || DEFAULT_FLEVOPAY_KEY;
const FLEVOPAY_POSTBACK_URL = process.env.FLEVOPAY_POSTBACK_URL || '';

// Token Utmify
const DEFAULT_UTMIFY_TOKEN = Buffer.from('NnlxV0JnQTB6MmNndEtHRE1YUlhOUHNNaGxubHNMaG43R1JC', 'base64').toString('utf8');
const UTMIFY_API_TOKEN = process.env.UTMIFY_API_TOKEN || DEFAULT_UTMIFY_TOKEN;

const transactionsDb = new Map();

const FAQ_REPLIES = {
  'entrega': 'Nosso prazo de entrega padrão é de 8 a 12 dias úteis com Frete Grátis, ou em até 5 dias úteis no Frete Expresso com rastreamento completo em tempo real!',
  'pagamento': 'O pagamento é realizado via PIX com segurança e aprovação instantânea pelo gateway oficial FlevoPay!',
  'voltagem': 'Nossos produtos estão disponíveis nas voltagens 110V e 220V, e o Projetor HY320 é Bivolt automático (110V/220V)!',
  'frigobar': 'O Frigobar Mondial possui 73 Litros de capacidade, gaveta de gelo, prateleiras ajustáveis e alta eficiência energética!',
  'lavadora': 'A WAP Lavadora WL 1800 possui 1400W de potência, 1500 PSI de pressão e vazão máxima de 360 L/h, com economia de até 80% de água!',
  'projetor': 'O Projetor HY320 Davely conta com 390 ANSI Lumens, Smart TV Android com apps integrados, WiFi 6, Bluetooth 5.0, rotação de 180° no teto/parede e suporte a 4K UHD!',
  'hy320': 'O Projetor HY320 Davely conta com 390 ANSI Lumens, Smart TV Android com apps integrados, WiFi 6, Bluetooth 5.0, rotação de 180° e suporte a 4K UHD!',
  'lumens': 'O Projetor HY320 entrega 390 ANSI Lumens com tecnologia LCD LED de alta definição e decodificação 4K!',
  'teto': 'Sim! O Projetor HY320 possui base giratória de 180°, permitindo projetar confortavelmente no teto do quarto ou em qualquer parede!',
  'garantia': 'Garantia de fábrica com cobertura nacional e assistência técnica em todo o Brasil!',
  'devolucao': 'Você possui até 30 dias após o recebimento para devolução gratuita garantida.'
}

function getUtcDateString(d) {
  try {
    const date = d ? new Date(d) : new Date();
    if (isNaN(date.getTime())) return new Date().toISOString().replace('T', ' ').substring(0, 19);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  } catch (e) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}

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

// Envia dados de venda (PIX gerado / PIX pago) para a API Oficial da Utmify
async function sendUtmifyOrder(orderData, isTest = false) {
  if (!UTMIFY_API_TOKEN) {
    console.log('[Utmify] Token não configurado, pulando envio.');
    return { ok: false, error: 'Token não configurado' };
  }

  const cust = orderData.customer || {};
  const tracking = orderData.trackingParameters || {};

  const payload = {
    orderId: String(orderData.orderId),
    platform: 'FlevoPay',
    paymentMethod: 'pix',
    status: orderData.status, // 'waiting_payment' ou 'paid'
    createdAt: orderData.createdAt || getUtcDateString(),
    approvedDate: orderData.status === 'paid' ? (orderData.approvedDate || getUtcDateString()) : null,
    refundedAt: null,
    customer: {
      name: cust.name || 'Cliente Mondial',
      email: cust.email || 'cliente@pagamento.com',
      phone: cust.phone || '11999999999',
      document: cust.document || '05477464003',
      country: 'BR',
      ip: cust.ip || '127.0.0.1'
    },
    products: orderData.products && orderData.products.length ? orderData.products : [
      {
        id: 'wap-wl-1800', name: 'WAP Lavadora WL 1800 1500 PSI',
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: orderData.amountCents || 12490
      }
    ],
    trackingParameters: {
      src: tracking.src || null,
      sck: tracking.sck || null,
      utm_source: tracking.utm_source || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_medium: tracking.utm_medium || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null
    },
    commission: {
      totalPriceInCents: orderData.amountCents || 12490,
      gatewayFeeInCents: 0,
      userCommissionInCents: orderData.amountCents || 12490
    },
    isTest: Boolean(isTest)
  };

  try {
    console.log(`[Utmify] Notificando pedido ${payload.orderId} com status: ${payload.status} (isTest: ${payload.isTest})`);
    const res = await fetch('https://api.utmify.com.br/api-credentials/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': UTMIFY_API_TOKEN
      },
      body: JSON.stringify(payload)
    });

    const resData = await res.json().catch(() => null);
    console.log(`[Utmify Response] Status ${res.status}:`, resData);
    return { ok: res.ok, status: res.status, data: resData };
  } catch (err) {
    console.error('[Utmify Erro]:', err.message);
    return { ok: false, error: err.message };
  }
}

async function createFlevoPix(payload, clientIp) {
  const descLower = (payload.description || (payload.products && payload.products[0] && payload.products[0].name) || '').toLowerCase();
  let defaultAmount = 124.90;
  let prodId = 'frigobar-73l';
  let prodName = 'Frigobar Mondial 73L';
  let fallbackClientName = 'Cliente Mondial';

  if (descLower.includes('projetor') || descLower.includes('hy320')) {
    defaultAmount = 255.90;
    prodId = 'projetor-hy320';
    prodName = 'Projetor HY320 Smart TV Android 4K';
    fallbackClientName = 'Cliente Projetor';
  } else if (descLower.includes('wap') || descLower.includes('lavadora')) {
    defaultAmount = 57.90;
    prodId = 'wap-wl-1800';
    prodName = 'WAP Lavadora WL 1800 1500 PSI';
    fallbackClientName = 'Cliente WAP';
  }

  const amountFloat = Number(payload.amount || defaultAmount);
  const amountCents = Math.max(100, Math.round(amountFloat * 100));

  const client = payload.client || {};
  const docDigits = cleanDoc(client.document);
  const phoneDigits = formatPhone(client.phone);
  const tracking = payload.tracking || {};
  const reference = 'REF_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const flevoPayload = {
    amount: amountCents,
    description: prodName,
    reference: reference,
    source: 'api_externa',
    customer: {
      name: (client.name && client.name.trim().length >= 3) ? client.name.trim() : fallbackClientName,
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
    throw new Error('Chave de API da FlevoPay não configurada.');
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

  if (!qrCodeUrl && copyPaste) {
    try {
      qrCodeUrl = await QRCode.toDataURL(copyPaste, { margin: 1, width: 320 });
    } catch (e) {
      qrCodeUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(copyPaste);
    }
  }

  const txId = String(resData.transaction_id || resData.id || reference);
  const nowUtc = getUtcDateString();

  const orderRecord = {
    orderId: txId,
    status: 'waiting_payment',
    createdAt: nowUtc,
    approvedDate: null,
    amountCents: amountCents,
    customer: {
      name: flevoPayload.customer.name,
      email: flevoPayload.customer.email,
      phone: flevoPayload.customer.phone,
      document: flevoPayload.customer.document,
      ip: clientIp || '127.0.0.1'
    },
        products: payload.products && payload.products.length ? payload.products.map(p => ({
      id: p.id || prodId,
      name: p.name || prodName,
      planId: null,
      planName: null,
      quantity: p.quantity || 1,
      priceInCents: p.price ? Math.round(Number(p.price) * 100) : (p.priceInCents || amountCents)
    })) : [
      {
        id: prodId,
        name: prodName,
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: amountCents
      }
    ],
    trackingParameters: {
      src: flevoPayload.tracking.src || null,
      sck: flevoPayload.tracking.sck || null,
      utm_source: flevoPayload.tracking.utm_source || null,
      utm_campaign: flevoPayload.tracking.utm_campaign || null,
      utm_medium: flevoPayload.tracking.utm_medium || null,
      utm_content: flevoPayload.tracking.utm_content || null,
      utm_term: flevoPayload.tracking.utm_term || null
    },
    utmifyPaidSent: false
  };

  transactionsDb.set(txId, orderRecord);

  // Notifica Utmify sobre o PIX GERADO (assíncrono)
  sendUtmifyOrder(orderRecord, false).catch(e => console.error('[Utmify Pix Gerado Erro]:', e.message));

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

      const custData = (resJson.customer_data && resJson.customer_data.customer) || {};
      const trackData = (resJson.customer_data && resJson.customer_data.tracking) || {};

      const cached = transactionsDb.get(txId) || {
        orderId: txId,
        createdAt: resJson.created_at ? getUtcDateString(resJson.created_at) : getUtcDateString(),
        amountCents: resJson.amount || 12490,
        customer: {
          name: custData.name,
          email: custData.email,
          phone: custData.phone,
          document: custData.document,
          ip: (resJson.customer_data && resJson.customer_data.api_metadata && resJson.customer_data.api_metadata.ip) || '127.0.0.1'
        },
        trackingParameters: {
          src: trackData.src || null,
          sck: trackData.sck || null,
          utm_source: trackData.utm_source || null,
          utm_campaign: trackData.utm_campaign || null,
          utm_medium: trackData.utm_medium || null,
          utm_content: trackData.utm_content || null,
          utm_term: trackData.utm_term || null
        },
        utmifyPaidSent: false
      };

      cached.status = mappedStatus;

      // Se o status for pago e ainda não enviamos para a Utmify:
      if (mappedStatus === 'paid' && !cached.utmifyPaidSent) {
        cached.approvedDate = getUtcDateString();
        cached.utmifyPaidSent = true;
        sendUtmifyOrder(cached, false).catch(e => console.error('[Utmify Pix Pago Erro]:', e.message));
      }

      transactionsDb.set(txId, cached);
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

  // Endpoint de teste da Utmify
  if (pathname.endsWith('/utmify/test') && req.method === 'POST') {
    const now = getUtcDateString();
    const testOrder = {
      orderId: 'TEST_' + Date.now(),
      status: 'waiting_payment',
      createdAt: now,
      approvedDate: null,
      amountCents: 12490,
      customer: {
        name: 'Cliente Teste Utmify',
        email: 'teste@exemplo.com',
        phone: '11999999999',
        document: '05477464003',
        ip: '127.0.0.1'
      },
      products: [
        {
          id: 'wap-wl-1800', name: 'WAP Lavadora WL 1800 1500 PSI',
          planId: null,
          planName: null,
          quantity: 1,
          priceInCents: 12490
        }
      ],
      trackingParameters: {
        src: null,
        sck: null,
        utm_source: 'tiktok',
        utm_campaign: 'promo_frigobar',
        utm_medium: 'cpc',
        utm_content: 'video_01',
        utm_term: null
      }
    };

    // Teste 1: PIX Gerado
    const r1 = await sendUtmifyOrder(testOrder, false);

    // Teste 2: PIX Pago
    testOrder.status = 'paid';
    testOrder.approvedDate = now;
    const r2 = await sendUtmifyOrder(testOrder, false);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      message: 'Notificações de teste enviadas para a Utmify!',
      pix_gerado_response: r1,
      pix_pago_response: r2
    }));
    return;
  }

  // Webhook FlevoPay
  if ((pathname.endsWith('/webhook/flevopay') || pathname.endsWith('/webhook/freepay')) && req.method === 'POST') {
    let webhookData = req.body;
    if (typeof webhookData === 'string') {
      try { webhookData = JSON.parse(webhookData); } catch(e){}
    }
    if (!webhookData) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      try { webhookData = JSON.parse(raw || '{}'); } catch(e){ webhookData = {}; }
    }
    const txId = String(webhookData.transaction_id || webhookData.id || webhookData.external_id || '');
    const rawStatus = (webhookData.status || webhookData.payment_status || '').toLowerCase();
    if (txId && (rawStatus === 'approved' || rawStatus === 'paid' || rawStatus === 'completed')) {
      const custData = (webhookData.customer_data && webhookData.customer_data.customer) || webhookData.customer || {};
      const trackData = (webhookData.customer_data && webhookData.customer_data.tracking) || webhookData.tracking || {};

      const cached = transactionsDb.get(txId) || {
        orderId: txId,
        createdAt: webhookData.created_at ? getUtcDateString(webhookData.created_at) : getUtcDateString(),
        amountCents: webhookData.amount || 12490,
        customer: {
          name: custData.name,
          email: custData.email,
          phone: custData.phone,
          document: custData.document,
          ip: (webhookData.customer_data && webhookData.customer_data.api_metadata && webhookData.customer_data.api_metadata.ip) || '127.0.0.1'
        },
        trackingParameters: {
          src: trackData.src || null,
          sck: trackData.sck || null,
          utm_source: trackData.utm_source || null,
          utm_campaign: trackData.utm_campaign || null,
          utm_medium: trackData.utm_medium || null,
          utm_content: trackData.utm_content || null,
          utm_term: trackData.utm_term || null
        },
        utmifyPaidSent: false
      };

      cached.status = 'paid';
      if (!cached.utmifyPaidSent) {
        cached.approvedDate = getUtcDateString();
        cached.utmifyPaidSent = true;
        sendUtmifyOrder(cached, false).catch(e => console.error('[Utmify Webhook Paid Erro]:', e.message));
      }
      transactionsDb.set(txId, cached);
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
    let reply = 'Olá! Nossa Lavadora de Alta Pressão WAP WL 1800 (1400W, 1500 PSI) está com super desconto de Oferta Relâmpago e estoque limitado. Acompanha kit completo de acessórios e garantia oficial de 1 ano!';
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
