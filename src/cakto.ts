const BASE_URL = 'https://api.cakto.com.br';

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

export async function getAccessToken(): Promise<string> {
  const clientId = process.env.CAKTO_CLIENT_ID;
  const clientSecret = process.env.CAKTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('CAKTO_CLIENT_ID/CAKTO_CLIENT_SECRET não configurados');
  }

  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${BASE_URL}/public_api/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Cakto auth falhou (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as TokenResponse;
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function authed<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Cakto ${init.method ?? 'GET'} ${path} (${res.status}): ${txt}`);
  }
  return (await res.json()) as T;
}

export type CaktoProduct = {
  id: string;
  name: string;
  price: number;
  type: string;
  status: string;
};

export type CaktoOffer = {
  id: string;
  name: string;
  price: number;
  product: string;
  status: string;
  type: string;
};

type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export async function listProducts(): Promise<CaktoProduct[]> {
  const data = await authed<Paginated<CaktoProduct>>('/public_api/products/?limit=100');
  return data.results;
}

export async function listOffers(productId?: string): Promise<CaktoOffer[]> {
  const qs = productId ? `?product=${productId}&limit=100` : '?limit=100';
  const data = await authed<Paginated<CaktoOffer>>(`/public_api/offers/${qs}`);
  return data.results;
}

export async function createProduct(params: {
  name: string;
  price: number;
  description?: string;
}): Promise<CaktoProduct> {
  return authed<CaktoProduct>('/public_api/products/', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      price: params.price,
      type: 'unique',
      status: 'active',
      description: params.description ?? params.name,
    }),
  });
}

export async function createOffer(params: {
  name: string;
  price: number;
  productId: string;
}): Promise<CaktoOffer> {
  return authed<CaktoOffer>('/public_api/offers/', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      price: params.price,
      product: params.productId,
      type: 'unique',
      status: 'active',
    }),
  });
}

export function checkoutUrl(offerId: string): string {
  return `https://pay.cakto.com.br/${offerId}`;
}
