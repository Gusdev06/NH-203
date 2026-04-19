import { readFileSync, existsSync } from 'node:fs';

export type OfferInfo = { offerId: string; url: string; price: number };

const path = new URL('./cakto-offers.json', import.meta.url);

let cache: Record<string, OfferInfo> | null = null;

export function loadOffers(): Record<string, OfferInfo> {
  if (cache) return cache;
  if (!existsSync(path)) {
    console.warn(
      '⚠️  src/cakto-offers.json não existe — rode `npm run cakto:setup` para gerar.'
    );
    cache = {};
    return cache;
  }
  cache = JSON.parse(readFileSync(path, 'utf8')) as Record<string, OfferInfo>;
  return cache;
}

export function getOffer(pkgId: string): OfferInfo | undefined {
  return loadOffers()[pkgId];
}
