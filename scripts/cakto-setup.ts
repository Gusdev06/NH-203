import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import {
  listProducts,
  listOffers,
  createOffer,
  checkoutUrl,
} from '../src/cakto.ts';
import { PACKAGES, CREDITS_PER_IMAGE } from '../src/packages.ts';

function offerNameFor(credits: number): string {
  const images = credits / CREDITS_PER_IMAGE;
  return `HOT — ${images} imagens (${credits} créditos)`;
}

async function main() {
  console.log('🔐 Autenticando na Cakto...');

  const products = await listProducts();
  console.log(`\n📦 ${products.length} produto(s) encontrado(s):`);
  for (const p of products) {
    console.log(`  • ${p.id}  ${p.name}  R$${p.price}  ${p.status}`);
  }

  let productId = process.env.CAKTO_PRODUCT_ID?.trim();

  if (!productId) {
    const active = products.filter((p) => p.status === 'active');
    if (active.length === 1) {
      productId = active[0].id;
      console.log(`\n✅ Usando o único produto ativo: ${productId}`);
    } else if (active.length === 0) {
      console.error(
        '\n❌ Nenhum produto ativo na sua Cakto. Crie um produto no dashboard primeiro ' +
          '(https://app.cakto.com.br) com conteúdo "telegram" ou similar, depois rode este script de novo.'
      );
      process.exit(1);
    } else {
      console.error(
        '\n❌ Múltiplos produtos ativos. Defina CAKTO_PRODUCT_ID no .env com o ID do produto desejado.'
      );
      process.exit(1);
    }
  }

  const existing = await listOffers(productId);
  const existingByName = new Map(existing.map((o) => [o.name, o]));

  console.log(`\n🏷️  ${existing.length} oferta(s) já existente(s) no produto.`);

  const offerMap: Record<string, { offerId: string; url: string; price: number }> = {};

  for (const pkg of PACKAGES) {
    const name = offerNameFor(pkg.credits);
    let offer = existingByName.get(name);
    if (offer) {
      console.log(`  ↪ ${name} já existe (${offer.id}), pulando.`);
    } else {
      console.log(`  + Criando: ${name} — R$${pkg.priceBrl}`);
      offer = await createOffer({
        name,
        price: pkg.priceBrl,
        productId,
      });
    }
    offerMap[pkg.id] = {
      offerId: offer.id,
      url: checkoutUrl(offer.id),
      price: pkg.priceBrl,
    };
  }

  const outPath = new URL('../src/cakto-offers.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(offerMap, null, 2));
  console.log(`\n💾 Salvo: src/cakto-offers.json`);

  console.log('\n🔗 Checkout URLs:');
  for (const [pkgId, info] of Object.entries(offerMap)) {
    console.log(`  ${pkgId.padEnd(6)} R$${info.price.toString().padEnd(4)} → ${info.url}`);
  }

  if (!process.env.CAKTO_PRODUCT_ID) {
    console.log(
      `\n💡 Dica: grava CAKTO_PRODUCT_ID=${productId} no .env pra pular a detecção automática.`
    );
  }
}

main().catch((err) => {
  console.error('\n💥 Erro:', err.message);
  process.exit(1);
});
