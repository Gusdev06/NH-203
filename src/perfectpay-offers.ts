import { readFileSync, existsSync } from 'node:fs';

export type PerfectPayOfferInfo = {
  planCode: string;
  checkoutCode: string;
  url: string;
  price: number;
};

const brlPath = new URL('./perfectpay-offers.json', import.meta.url);
const usdPath = new URL('./perfectpay-offers-usd.json', import.meta.url);

let brlCache: Record<string, PerfectPayOfferInfo> | null = null;
let usdCache: Record<string, PerfectPayOfferInfo> | null = null;

function loadFile(path: URL, label: string): Record<string, PerfectPayOfferInfo> {
  if (!existsSync(path)) {
    console.warn(`⚠️  src/${label} não existe.`);
    return {};
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, PerfectPayOfferInfo>;
}

export function loadOffers(): Record<string, PerfectPayOfferInfo> {
  if (!brlCache) brlCache = loadFile(brlPath, 'perfectpay-offers.json');
  if (!usdCache) usdCache = loadFile(usdPath, 'perfectpay-offers-usd.json');
  return { ...brlCache, ...usdCache };
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
