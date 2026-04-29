import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { handleCaktoWebhook } from './webhook.ts';
import { handlePerfectPayWebhook } from './webhook-perfectpay.ts';
import {
  getAdminStats,
  getUserDetail,
  adminAddCredits,
  setBanned,
  setUserNote,
  getAllOrdersForCsv,
  getAllGenerationsForCsv,
  searchUsers,
  resolveUserTarget,
} from './db.ts';
import {
  renderAdminDashboard,
  renderUserDetail,
  renderUsersList,
  renderNotFound,
  ordersToCsv,
  generationsToCsv,
} from './admin.ts';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function sendCsv(res: ServerResponse, filename: string, csv: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(csv);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

function buildFlashUrl(
  base: string,
  returnPath: string,
  flash: { ok?: string; err?: string }
): string {
  const clean = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const params = new URLSearchParams();
  if (flash.ok) params.set('ok', flash.ok);
  if (flash.err) params.set('err', flash.err);
  const qs = params.toString();
  return `${base}${clean === '/' ? '/' : clean}${qs ? `?${qs}` : ''}`;
}

function parseUrl(rawUrl: string): { pathname: string; query: URLSearchParams } {
  const qIdx = rawUrl.indexOf('?');
  const pathname = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
  const query = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '');
  return { pathname, query };
}

async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  basePath: string,
  subPath: string,
  query: URLSearchParams
): Promise<void> {
  const flash = {
    ok: query.get('ok') ?? undefined,
    err: query.get('err') ?? undefined,
  };

  if (req.method === 'GET' && (subPath === '/' || subPath === '')) {
    sendHtml(res, 200, renderAdminDashboard(getAdminStats(), basePath, flash));
    return;
  }

  if (req.method === 'GET' && subPath === '/export/orders.csv') {
    sendCsv(res, 'orders.csv', ordersToCsv(getAllOrdersForCsv()));
    return;
  }

  if (req.method === 'GET' && subPath === '/export/generations.csv') {
    sendCsv(res, 'generations.csv', generationsToCsv(getAllGenerationsForCsv()));
    return;
  }

  const userMatch = subPath.match(/^\/user\/(-?\d+)$/);
  if (req.method === 'GET' && userMatch) {
    const tgId = Number(userMatch[1]);
    const detail = getUserDetail(tgId);
    if (!detail) {
      sendHtml(res, 404, renderNotFound(basePath));
      return;
    }
    sendHtml(res, 200, renderUserDetail(detail, basePath, flash));
    return;
  }

  if (req.method === 'GET' && subPath === '/users') {
    const q = query.get('q') ?? '';
    const users = searchUsers(q);
    sendHtml(res, 200, renderUsersList(users, basePath, q, flash));
    return;
  }

  if (req.method === 'POST' && subPath === '/credits') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const targetRaw =
      params.get('target') ?? params.get('telegram_id') ?? '';
    const amount = Number(params.get('amount'));
    const returnTo = params.get('return') ?? '/';
    if (!Number.isInteger(amount) || amount === 0) {
      redirect(res, buildFlashUrl(basePath, returnTo, { err: 'valor inválido' }));
      return;
    }
    const tgId = resolveUserTarget(targetRaw);
    if (!tgId) {
      redirect(
        res,
        buildFlashUrl(basePath, returnTo, {
          err: `usuário "${targetRaw}" não encontrado`,
        })
      );
      return;
    }
    const result = adminAddCredits(tgId, amount);
    if (!result.ok) {
      redirect(res, buildFlashUrl(basePath, returnTo, { err: result.reason }));
      return;
    }
    const verb = amount >= 0 ? 'adicionados' : 'removidos';
    redirect(
      res,
      buildFlashUrl(basePath, returnTo, {
        ok: `${Math.abs(amount)} créditos ${verb} — ${tgId} agora tem ${result.credits}`,
      })
    );
    return;
  }

  if (req.method === 'POST' && subPath === '/note') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const tgId = Number(params.get('telegram_id'));
    const note = (params.get('note') ?? '').trim();
    const returnTo = params.get('return') ?? '/';
    if (!Number.isInteger(tgId)) {
      redirect(res, buildFlashUrl(basePath, returnTo, { err: 'id inválido' }));
      return;
    }
    const ok = setUserNote(tgId, note === '' ? null : note);
    if (!ok) {
      redirect(
        res,
        buildFlashUrl(basePath, returnTo, { err: 'usuário não encontrado' })
      );
      return;
    }
    redirect(
      res,
      buildFlashUrl(basePath, returnTo, { ok: 'nota salva' })
    );
    return;
  }

  if (req.method === 'POST' && subPath === '/ban') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const tgId = Number(params.get('telegram_id'));
    const banned = params.get('banned') === '1';
    const returnTo = params.get('return') ?? '/';
    if (!Number.isInteger(tgId)) {
      redirect(res, buildFlashUrl(basePath, returnTo, { err: 'id inválido' }));
      return;
    }
    const ok = setBanned(tgId, banned);
    if (!ok) {
      redirect(
        res,
        buildFlashUrl(basePath, returnTo, { err: 'usuário não encontrado' })
      );
      return;
    }
    redirect(
      res,
      buildFlashUrl(basePath, returnTo, {
        ok: banned ? `${tgId} banido` : `${tgId} desbanido`,
      })
    );
    return;
  }

  sendHtml(res, 404, renderNotFound(basePath));
}

export function startServer(bot: Bot): void {
  const port = Number(process.env.WEBHOOK_PORT ?? 3000);
  const webhookSecret = process.env.CAKTO_WEBHOOK_SECRET;
  const perfectPaySecret = process.env.PERFECTPAY_WEBHOOK_SECRET;
  const adminToken = process.env.ADMIN_TOKEN;
  const telegramSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!webhookSecret && !perfectPaySecret && !adminToken && !telegramSecret) {
    console.warn(
      '⚠️  Nenhum secret configurado (CAKTO/PERFECTPAY/ADMIN/TELEGRAM) — servidor HTTP não iniciado.'
    );
    return;
  }

  const webhookPath = webhookSecret ? `/webhook/cakto/${webhookSecret}` : null;
  const perfectPayPath = perfectPaySecret
    ? `/webhook/perfectpay/${perfectPaySecret}`
    : null;
  const adminPrefix = adminToken ? `/admin/${adminToken}` : null;
  const telegramPath = telegramSecret ? `/telegram/${telegramSecret}` : null;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? '/';
    const { pathname, query } = parseUrl(rawUrl);

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    if (
      adminPrefix &&
      (pathname === adminPrefix || pathname.startsWith(adminPrefix + '/'))
    ) {
      const subPath = pathname.slice(adminPrefix.length) || '/';
      try {
        await handleAdmin(req, res, adminPrefix, subPath, query);
      } catch (err) {
        console.error('[admin] erro:', err);
        if (!res.headersSent) res.writeHead(500).end('error');
      }
      return;
    }

    if (req.method === 'POST' && webhookPath && pathname === webhookPath) {
      try {
        const body = await readBody(req);
        const result = await handleCaktoWebhook(bot, body);
        res.writeHead(result.httpStatus, { 'Content-Type': 'text/plain' });
        res.end(result.body);
      } catch (err) {
        console.error('[server] erro no webhook cakto:', err);
        res.writeHead(500).end('error');
      }
      return;
    }

    if (req.method === 'POST' && perfectPayPath && pathname === perfectPayPath) {
      try {
        const body = await readBody(req);
        const result = await handlePerfectPayWebhook(bot, body);
        res.writeHead(result.httpStatus, { 'Content-Type': 'text/plain' });
        res.end(result.body);
      } catch (err) {
        console.error('[server] erro no webhook perfectpay:', err);
        res.writeHead(500).end('error');
      }
      return;
    }

    if (req.method === 'POST' && telegramPath && pathname === telegramPath) {
      const headerToken = req.headers['x-telegram-bot-api-secret-token'];
      if (headerToken !== telegramSecret) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      try {
        const body = await readBody(req);
        const update = JSON.parse(body);
        res.writeHead(200).end('ok');
        bot
          .handleUpdate(update)
          .catch((err) => console.error('[telegram] handleUpdate falhou:', err));
      } catch (err) {
        console.error('[telegram] erro parseando update:', err);
        if (!res.headersSent) res.writeHead(400).end('bad request');
      }
      return;
    }

    res.writeHead(404).end('not found');
  });

  server.listen(port, () => {
    if (webhookPath) {
      console.log(`🌐 Webhook Cakto ouvindo em http://localhost:${port}${webhookPath}`);
    } else {
      console.warn('⚠️  CAKTO_WEBHOOK_SECRET não configurado — webhook Cakto desativado.');
    }
    if (perfectPayPath) {
      console.log(`🌐 Webhook Perfect Pay ouvindo em http://localhost:${port}${perfectPayPath}`);
    } else {
      console.warn('⚠️  PERFECTPAY_WEBHOOK_SECRET não configurado — webhook Perfect Pay desativado.');
    }
    if (telegramPath) {
      console.log(`📨 Webhook Telegram ouvindo em http://localhost:${port}${telegramPath}`);
    }
    if (adminPrefix) {
      console.log(`📊 Admin em http://localhost:${port}${adminPrefix}`);
    }
  });
}
