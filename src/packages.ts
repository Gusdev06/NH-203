export type Currency = 'BRL' | 'XTR';

export type CreditPackage = {
  id: string;
  credits: number;
  price: number;
  currency: Currency;
  bonusImages?: number;
};

export const CREDITS_PER_IMAGE = 5;

export const PACKAGES_BRL: CreditPackage[] = [
  { id: 'p10', credits: 30, price: 10, currency: 'BRL' },
  { id: 'p25', credits: 75, price: 25, currency: 'BRL' },
  { id: 'p50', credits: 150, price: 50, currency: 'BRL' },
  { id: 'p75', credits: 250, price: 75, currency: 'BRL', bonusImages: 5 },
  { id: 'p100', credits: 350, price: 100, currency: 'BRL', bonusImages: 10 },
  { id: 'p150', credits: 550, price: 150, currency: 'BRL', bonusImages: 20 },
  { id: 'p200', credits: 800, price: 200, currency: 'BRL', bonusImages: 40 },
  { id: 'p300', credits: 1250, price: 300, currency: 'BRL', bonusImages: 70 },
];

export const PACKAGES_XTR: CreditPackage[] = [
  { id: 'x250', credits: 75, price: 250, currency: 'XTR' },
  { id: 'x500', credits: 150, price: 500, currency: 'XTR' },
  { id: 'x750', credits: 250, price: 750, currency: 'XTR', bonusImages: 5 },
  { id: 'x1000', credits: 350, price: 1000, currency: 'XTR', bonusImages: 10 },
  { id: 'x1500', credits: 550, price: 1500, currency: 'XTR', bonusImages: 20 },
  { id: 'x2000', credits: 800, price: 2000, currency: 'XTR', bonusImages: 40 },
  { id: 'x3000', credits: 1250, price: 3000, currency: 'XTR', bonusImages: 70 },
];

export const PACKAGES: CreditPackage[] = [...PACKAGES_BRL, ...PACKAGES_XTR];

export function findPackage(id: string): CreditPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

export function packagesFor(currency: Currency): CreditPackage[] {
  return currency === 'XTR' ? PACKAGES_XTR : PACKAGES_BRL;
}

export function currencyForLanguage(languageCode: string | null | undefined): Currency {
  if (!languageCode) return 'XTR';
  return /^pt(-|$)/i.test(languageCode) ? 'BRL' : 'XTR';
}

export function formatPrice(value: number, currency: Currency): string {
  if (currency === 'XTR') {
    return `⭐ ${value.toLocaleString('en-US')}`;
  }
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatBrl(value: number): string {
  return formatPrice(value, 'BRL');
}
