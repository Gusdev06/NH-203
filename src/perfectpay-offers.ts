import { readFileSync, existsSync } from 'node:fs';

export type PerfectPayOfferInfo = {
  planCode: string;
  checkoutCode: string;
  url: string;
  price: number;
};

const path = new URL('./perfectpay-offers.json', import.meta.url);

let cache: Record<string, PerfectPayOfferInfo> | null = null;

export function loadOffers(): Record<string, PerfectPayOfferInfo> {
  if (cache) return cache;
  if (!existsSync(path)) {
    console.warn('⚠️  src/perfectpay-offers.json não existe.');
    cache = {};
    return cache;
  }
  cache = JSON.parse(readFileSync(path, 'utf8')) as Record<string, PerfectPayOfferInfo>;
  return cache;
}

export function getOffer(pkgId: string): PerfectPayOfferInfo | undefined {
  return loadOffers()[pkgId];
}

export function planCodeToPkgId(planCode: string): string | null {
  for (const [pkgId, info] of Object.entries(loadOffers())) {
    if (info.planCode === planCode) return pkgId;
  }
  return null;
}
