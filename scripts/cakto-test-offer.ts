import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { createOffer, checkoutUrl } from '../src/cakto.ts';

async function main() {
  const productId = process.env.CAKTO_PRODUCT_ID;
  if (!productId) throw new Error('CAKTO_PRODUCT_ID não definido');

  const offer = await createOffer({
    name: 'HOT — TESTE R$5 (1 imagem)',
    price: 5,
    productId,
  });
  const url = checkoutUrl(offer.id);
  console.log('✅ Oferta de teste criada:');
  console.log('  offerId:', offer.id);
  console.log('  url:', url);

  const offersPath = new URL('../src/cakto-offers.json', import.meta.url);
  const offers = JSON.parse(readFileSync(offersPath, 'utf8')) as Record<
    string,
    { offerId: string; url: string; price: number }
  >;
  offers.test5 = { offerId: offer.id, url, price: 5 };
  writeFileSync(offersPath, JSON.stringify(offers, null, 2));
  console.log('💾 Salvo em cakto-offers.json como "test5"');
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
