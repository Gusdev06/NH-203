import 'dotenv/config';
import { getAccessToken } from '../src/cakto.ts';

async function main() {
  const baseUrl = process.env.WEBHOOK_BASE_URL?.trim();
  const secret = process.env.CAKTO_WEBHOOK_SECRET;
  const productId = process.env.CAKTO_PRODUCT_ID;

  if (!baseUrl) {
    console.error('❌ WEBHOOK_BASE_URL não definido no .env (ex: https://xxx.ngrok.io)');
    process.exit(1);
  }
  if (!secret) {
    console.error('❌ CAKTO_WEBHOOK_SECRET não definido');
    process.exit(1);
  }
  if (!productId) {
    console.error('❌ CAKTO_PRODUCT_ID não definido');
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/$/, '')}/webhook/cakto/${secret}`;
  console.log(`🔗 Registrando webhook: ${url}`);

  const token = await getAccessToken();

  const listRes = await fetch('https://api.cakto.com.br/public_api/webhook/?limit=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    console.error('❌ Erro listando webhooks:', await listRes.text());
    process.exit(1);
  }
  const listData = (await listRes.json()) as { results: Array<{ id: string; url: string; name: string }> };
  const existing = listData.results.find((w) => w.name === 'HOT purchase_approved');

  const body = {
    name: 'HOT purchase_approved',
    url,
    status: 'active',
    products: [productId],
    events: ['purchase_approved'],
  };

  if (existing) {
    console.log(`↻ Atualizando webhook existente (id=${existing.id})`);
    const res = await fetch(`https://api.cakto.com.br/public_api/webhook/${existing.id}/`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('❌ Erro atualizando:', res.status, await res.text());
      process.exit(1);
    }
    console.log('✅ Webhook atualizado.');
  } else {
    const res = await fetch('https://api.cakto.com.br/public_api/webhook/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('❌ Erro criando:', res.status, await res.text());
      process.exit(1);
    }
    const created = (await res.json()) as { id: string };
    console.log(`✅ Webhook criado (id=${created.id}).`);
  }
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
