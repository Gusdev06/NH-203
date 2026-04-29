import type { Bot } from 'grammy';
import { processOrder, type ProcessOrderResult } from './db.ts';
import { planCodeToPkgId } from './perfectpay-offers.ts';
import { PACKAGES, CREDITS_PER_IMAGE } from './packages.ts';

type PerfectPayPayload = {
  token?: string;
  code?: string;
  sale_amount?: number;
  sale_status_enum?: number;
  sale_status_detail?: string;
  product?: { code?: string; name?: string };
  plan?: { code?: string; name?: string };
  customer?: { email?: string; full_name?: string };
  metadata?: {
    src?: string | null;
    sck?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
  };
};

const APPROVED_STATUS = 2;

function parseSrc(src: string): { telegramId: number; pkgId: string } | null {
  const match = /^tg_(\d+)_([a-z0-9]+)$/.exec(src);
  if (!match) return null;
  return { telegramId: Number(match[1]), pkgId: match[2] };
}

function extractTracking(payload: PerfectPayPayload): {
  telegramId: number | null;
  pkgId: string | null;
} {
  const meta = payload.metadata ?? {};
  const candidates: Array<string | null | undefined> = [
    meta.src,
    meta.utm_content,
    meta.sck,
    meta.utm_term,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const parsed = parseSrc(candidate);
    if (parsed) return parsed;
  }

  const planCode = payload.plan?.code;
  if (planCode) {
    return { telegramId: null, pkgId: planCodeToPkgId(planCode) };
  }
  return { telegramId: null, pkgId: null };
}

export type HandleResult = {
  httpStatus: number;
  body: string;
};

export async function handlePerfectPayWebhook(
  bot: Bot,
  rawBody: string
): Promise<HandleResult> {
  let payload: PerfectPayPayload;
  try {
    payload = JSON.parse(rawBody) as PerfectPayPayload;
  } catch {
    console.warn('[perfectpay] JSON inválido');
    return { httpStatus: 400, body: 'invalid json' };
  }

  const expectedToken = process.env.PERFECTPAY_WEBHOOK_TOKEN;
  if (expectedToken && payload.token !== expectedToken) {
    console.warn(
      `[perfectpay] token inválido — recebido="${payload.token}" esperado="${expectedToken}"`
    );
    return { httpStatus: 401, body: 'unauthorized' };
  }

  const orderId = payload.code;
  const status = payload.sale_status_enum;
  console.log(
    `[perfectpay] order=${orderId} status=${status} (${payload.sale_status_detail ?? '-'})`
  );

  if (!orderId) {
    console.warn('[perfectpay] sem code — ignorando', rawBody);
    return { httpStatus: 200, body: 'no order id' };
  }

  if (status !== APPROVED_STATUS) {
    return { httpStatus: 200, body: 'not approved' };
  }

  const { telegramId, pkgId } = extractTracking(payload);
  if (!telegramId || !pkgId) {
    console.warn(
      `[perfectpay] não consegui identificar telegram_id/pkg_id — order ${orderId}`
    );
    processOrder({
      orderId,
      telegramId: null,
      pkgId,
      credits: 0,
      amount: payload.sale_amount ?? 0,
      rawPayload: rawBody,
    });
    return { httpStatus: 200, body: 'unmatched' };
  }

  const pkg = PACKAGES.find((p) => p.id === pkgId);
  if (!pkg) {
    console.warn(`[perfectpay] pkg ${pkgId} desconhecido`);
    return { httpStatus: 200, body: 'unknown pkg' };
  }

  const result: ProcessOrderResult = processOrder({
    orderId,
    telegramId,
    pkgId,
    credits: pkg.credits,
    amount: payload.sale_amount ?? pkg.priceBrl,
    rawPayload: rawBody,
  });

  if (result.status === 'duplicate') {
    console.log(`[perfectpay] order ${orderId} já processada — ignorando`);
    return { httpStatus: 200, body: 'duplicate' };
  }

  const images = pkg.credits / CREDITS_PER_IMAGE;
  try {
    await bot.api.sendMessage(
      telegramId,
      `✅ Pagamento confirmado!\n\n${pkg.credits} créditos (${images} imagens) foram adicionados à sua conta.\n\nUse /gerar pra criar sua primeira imagem.`
    );
  } catch (err) {
    console.warn('[perfectpay] falha ao notificar usuário no Telegram:', err);
  }

  console.log(
    `[perfectpay] creditado: user=${telegramId} pkg=${pkgId} credits=${pkg.credits} order=${orderId}`
  );
  return { httpStatus: 200, body: 'ok' };
}
