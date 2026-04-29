export type Currency = 'BRL' | 'USD';

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

export const PACKAGES_USD: CreditPackage[] = [
  { id: 'u5', credits: 75, price: 5, currency: 'USD' },
  { id: 'u10', credits: 150, price: 10, currency: 'USD' },
  { id: 'u15', credits: 250, price: 15, currency: 'USD', bonusImages: 5 },
  { id: 'u20', credits: 350, price: 20, currency: 'USD', bonusImages: 10 },
  { id: 'u30', credits: 550, price: 30, currency: 'USD', bonusImages: 20 },
  { id: 'u40', credits: 800, price: 40, currency: 'USD', bonusImages: 40 },
  { id: 'u60', credits: 1250, price: 60, currency: 'USD', bonusImages: 70 },
];

export const PACKAGES: CreditPackage[] = [...PACKAGES_BRL, ...PACKAGES_USD];

export function findPackage(id: string): CreditPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

export function packagesFor(currency: Currency): CreditPackage[] {
  return currency === 'USD' ? PACKAGES_USD : PACKAGES_BRL;
}

export function currencyForLanguage(languageCode: string | null | undefined): Currency {
  if (!languageCode) return 'USD';
  return /^pt(-|$)/i.test(languageCode) ? 'BRL' : 'USD';
}

export function formatPrice(value: number, currency: Currency): string {
  if (currency === 'USD') {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatBrl(value: number): string {
  return formatPrice(value, 'BRL');
}
