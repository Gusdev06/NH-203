import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { handleCaktoWebhook } from './webhook.ts';
import {
  getAdminStats,
  getUserDetail,
  adminAddCredits,
  setBanned,
  getAllOrdersForCsv,
  getAllGenerationsForCsv,
} from './db.ts';
import {
  renderAdminDashboard,
  renderUserDetail,
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

  if (req.method === 'POST' && subPath === '/credits') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const tgId = Number(params.get('telegram_id'));
    const amount = Number(params.get('amount'));
    const returnTo = params.get('return') ?? '/';
    if (!Number.isInteger(tgId) || !Number.isInteger(amount)) {
      redirect(res, buildFlashUrl(basePath, returnTo, { err: 'valores inválidos' }));
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
  const adminToken = process.env.ADMIN_TOKEN;

  if (!webhookSecret && !adminToken) {
    console.warn(
      '⚠️  Nem CAKTO_WEBHOOK_SECRET nem ADMIN_TOKEN configurados — servidor HTTP não iniciado.'
    );
    return;
  }

  const webhookPath = webhookSecret ? `/webhook/cakto/${webhookSecret}` : null;
  const adminPrefix = adminToken ? `/admin/${adminToken}` : null;

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
        console.error('[server] erro no webhook:', err);
        res.writeHead(500).end('error');
      }
      return;
    }

    res.writeHead(404).end('not found');
  });

  server.listen(port, () => {
    if (webhookPath) {
      console.log(`🌐 Webhook ouvindo em http://localhost:${port}${webhookPath}`);
    } else {
      console.warn('⚠️  CAKTO_WEBHOOK_SECRET não configurado — webhook desativado.');
    }
    if (adminPrefix) {
      console.log(`📊 Admin em http://localhost:${port}${adminPrefix}`);
    }
  });
}
