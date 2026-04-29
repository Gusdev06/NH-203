export type CreditPackage = {
  id: string;
  credits: number;
  priceBrl: number;
  bonusImages?: number;
};

export const CREDITS_PER_IMAGE = 5;

export const PACKAGES: CreditPackage[] = [
  { id: 'p10', credits: 30, priceBrl: 10 },
  { id: 'p25', credits: 75, priceBrl: 25 },
  { id: 'p50', credits: 150, priceBrl: 50 },
  { id: 'p75', credits: 250, priceBrl: 75, bonusImages: 5 },
  { id: 'p100', credits: 350, priceBrl: 100, bonusImages: 10 },
  { id: 'p150', credits: 550, priceBrl: 150, bonusImages: 20 },
  { id: 'p200', credits: 800, priceBrl: 200, bonusImages: 40 },
  { id: 'p300', credits: 1250, priceBrl: 300, bonusImages: 70 },
];

export function findPackage(id: string): CreditPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

export function formatBrl(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
