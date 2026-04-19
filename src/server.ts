import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { handleCaktoWebhook } from './webhook.ts';
import { getAdminStats } from './db.ts';
import { renderAdminDashboard } from './admin.ts';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
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

  const webhookPath = webhookSecret
    ? `/webhook/cakto/${webhookSecret}`
    : null;
  const adminPath = adminToken ? `/admin/${adminToken}` : null;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }

    if (req.method === 'GET' && adminPath && req.url === adminPath) {
      try {
        const html = renderAdminDashboard(getAdminStats());
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
      } catch (err) {
        console.error('[admin] erro:', err);
        res.writeHead(500).end('error');
      }
      return;
    }

    if (req.method === 'POST' && webhookPath && req.url === webhookPath) {
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
    if (adminPath) {
      console.log(`📊 Admin em http://localhost:${port}${adminPath}`);
    }
  });
}
