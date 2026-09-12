# Frigobar Mondial Shop — Clone Idêntico com Gateway FreePay Brasil

Este projeto é uma réplica 100% autônoma e idêntica do funil de vendas **Frigobar Mondial Shop**, agora totalmente integrado com o gateway de pagamentos **FreePay Brasil**.

---

## ⚡ Integração FreePay Brasil (PIX Oficial)

O gateway FreePay Brasil está integrado diretamente no backend (`server.js`) com suporte a:
- ✅ **Criação de PIX** (`POST /v1/payment-transaction/create`) para o Checkout e todos os Upsells.
- ✅ **Consulta de Status** (`GET /v1/payment-transaction/info/{id}`) para avanço automático de etapas.
- ✅ **Webhook Oficial** (`POST /api/webhook/freepay`) com confirmação instantânea em tempo real.
- ✅ **Modo Simulação/Teste**: Se o arquivo `.env` não estiver preenchido com suas credenciais, o servidor roda em modo de demonstração para você testar todo o funil.

### 🔑 Como Configurar suas Credenciais da FreePay

1. Abra o arquivo **`.env`** na raiz do projeto (`c:\Users\paulo\Desktop\Freezer site\.env`).
2. Obtenha suas credenciais no painel da FreePay em **Credenciais API**:
   - [Documentação Oficial](https://freepaybrasil.readme.io/reference/introdução)
3. Preencha os campos:
```env
FREEPAY_PUBLIC_KEY=sua_public_key_aqui
FREEPAY_SECRET_KEY=sua_secret_key_aqui
FREEPAY_POSTBACK_URL=https://seudominio.com/api/webhook/freepay
PORT=3000
```
4. Inicie ou reinicie o servidor:
```bash
npm start
```

---

## 🚀 Como Executar Localmente

```bash
npm start
# ou
node server.js
```

Acesse no navegador: **http://localhost:3000**

---

## 📁 Estrutura do Funil

- **`index.html` / `site.html`**: Landing page com popup TikTok Show de Promo, galeria de fotos em alta definição, seletor de voltagem/cor, depoimentos de clientes e CTA.
- **`pagamento.html` / `/pagamento`**: Checkout de 3 etapas com validação de CPF, busca de CEP automática (ViaCEP), seleção de frete, Order Bumps e geração do PIX FreePay.
- **`upsell1.html` / `/upsell1`**: Oferta NF-e (R$ 55,79) com PIX FreePay.
- **`upsell2.html` / `/upsell2`**: Taxa TENF (R$ 34,65) com PIX FreePay.
- **`upsell3.html` / `/upsell3`**: Correção de Frete (R$ 43,80) com PIX FreePay.
- **`upsell4.html` / `/upsell4`**: Confirmação de Reembolso (R$ 43,10) com PIX FreePay.
- **`obrigado.html` / `/obrigado`**: Tela final de confirmação de pedido.
