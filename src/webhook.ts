import type { Bot } from 'grammy';
import { processOrder, type ProcessOrderResult } from './db.ts';
import { loadOffers } from './cakto-offers.ts';
import { PACKAGES, CREDITS_PER_IMAGE } from './packages.ts';

type CaktoPayload = {
  secret?: string;
  event?: string;
  data?: {
    id?: string;
    refId?: string;
    amount?: number;
    status?: string;
    checkoutUrl?: string;
    offer?: { id?: string; name?: string; price?: number };
    customer?: { email?: string; name?: string };
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_term?: string | null;
    utm_content?: string | null;
    sck?: string | null;
    src?: string | null;
  };
};

const APPROVED_EVENTS = new Set(['purchase_approved']);

function offerIdToPkgId(offerId: string): string | null {
  const offers = loadOffers();
  for (const [pkgId, info] of Object.entries(offers)) {
    if (info.offerId === offerId) return pkgId;
  }
  return null;
}

function parseSrc(src: string): { telegramId: number; pkgId: string } | null {
  // format: tg_<userId>_<pkgId>
  const match = /^tg_(\d+)_([a-z0-9]+)$/.exec(src);
  if (!match) return null;
  return { telegramId: Number(match[1]), pkgId: match[2] };
}

function extractTracking(data: NonNullable<CaktoPayload['data']>): {
  telegramId: number | null;
  pkgId: string | null;
} {
  const candidates: Array<string | null | undefined> = [
    data.utm_content,
    data.sck,
    data.src,
    data.utm_term,
    data.refId,
  ];

  if (typeof data.checkoutUrl === 'string') {
    try {
      const u = new URL(data.checkoutUrl);
      for (const key of ['utm_content', 'sck', 'src', 'utm_term']) {
        candidates.push(u.searchParams.get(key));
      }
    } catch {
      /* ignore */
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const parsed = parseSrc(candidate);
    if (parsed) return parsed;
  }

  const offerId = data.offer?.id;
  if (offerId) {
    return { telegramId: null, pkgId: offerIdToPkgId(offerId) };
  }
  return { telegramId: null, pkgId: null };
}

export type HandleResult = {
  httpStatus: number;
  body: string;
};

export async function handleCaktoWebhook(
  bot: Bot,
  rawBody: string
): Promise<HandleResult> {
  let payload: CaktoPayload;
  try {
    payload = JSON.parse(rawBody) as CaktoPayload;
  } catch {
    console.warn('[webhook] JSON inválido');
    return { httpStatus: 400, body: 'invalid json' };
  }

  const expectedSecret = process.env.CAKTO_PAYLOAD_SECRET;
  if (expectedSecret && payload.secret !== expectedSecret) {
    console.warn(
      `[webhook] secret inválido — recebido="${payload.secret}" esperado="${expectedSecret}"`
    );
    return { httpStatus: 401, body: 'unauthorized' };
  }

  const event = payload.event;
  const data = payload.data;
  console.log(`[webhook] evento=${event} order=${data?.id}`);

  if (!event || !data) {
    return { httpStatus: 200, body: 'ignored' };
  }

  if (!APPROVED_EVENTS.has(event)) {
    return { httpStatus: 200, body: 'ignored' };
  }

  if (data.status && data.status !== 'paid') {
    return { httpStatus: 200, body: 'not paid' };
  }

  const orderId = data.id;
  if (!orderId) {
    console.warn('[webhook] sem order id — ignorando', rawBody);
    return { httpStatus: 200, body: 'no order id' };
  }

  const { telegramId, pkgId } = extractTracking(data);
  if (!telegramId || !pkgId) {
    console.warn(
      `[webhook] não consegui identificar telegram_id/pkg_id — order ${orderId} — payload acima ☝️`
    );
    processOrder({
      orderId,
      telegramId: null,
      pkgId,
      credits: 0,
      amount: data.amount ?? 0,
      rawPayload: rawBody,
    });
    return { httpStatus: 200, body: 'unmatched' };
  }

  const pkg = PACKAGES.find((p) => p.id === pkgId);
  if (!pkg) {
    console.warn(`[webhook] pkg ${pkgId} desconhecido`);
    return { httpStatus: 200, body: 'unknown pkg' };
  }

  const result: ProcessOrderResult = processOrder({
    orderId,
    telegramId,
    pkgId,
    credits: pkg.credits,
    amount: data.amount ?? pkg.priceBrl,
    rawPayload: rawBody,
  });

  if (result.status === 'duplicate') {
    console.log(`[webhook] order ${orderId} já processada — ignorando`);
    return { httpStatus: 200, body: 'duplicate' };
  }

  const images = pkg.credits / CREDITS_PER_IMAGE;
  try {
    await bot.api.sendMessage(
      telegramId,
      `✅ Pagamento confirmado!\n\n${pkg.credits} créditos (${images} imagens) foram adicionados à sua conta.\n\nUse /gerar pra criar sua primeira imagem.`
    );
  } catch (err) {
    console.warn('[webhook] falha ao notificar usuário no Telegram:', err);
  }

  console.log(
    `[webhook] creditado: user=${telegramId} pkg=${pkgId} credits=${pkg.credits} order=${orderId}`
  );
  return { httpStatus: 200, body: 'ok' };
}
