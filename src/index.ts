import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { GatewayService } from './services/gateway.service.js';

const gatewayService = new GatewayService();

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function respondJson(res: any, statusCode: number, data: any): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function respondSSE(res: any): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function sendSSE(res: any, event: string, data: unknown): void {
  const payload = JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${payload}\n\n`);
}

export default definePluginEntry({
  id: 'openclaw-http-message',
  name: 'OpenClaw HTTP Message',
  description: 'HTTP interface for sending messages to OpenClaw gateway via WebSocket',
  async register(api) {
    await gatewayService.initialize();

    api.registerHttpRoute({
      path: '/api/gateway',
      auth: 'plugin',
      match: 'prefix',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts[0] !== 'api' || pathParts[1] !== 'gateway') {
          return false;
        }

        const apiPath = '/' + pathParts.slice(2).join('/');

        try {
          if (apiPath === '/' || apiPath === '/status') {
            if (req.method === 'GET') {
              respondJson(res, 200, {
                status: gatewayService.getStatus(),
                connected: gatewayService.isConnected(),
              });
              return true;
            }
          }

          if (apiPath === '/config') {
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              gatewayService.setConfig({
                wsUrl: body.wsUrl,
                authToken: body.authToken,
                authMode: body.authMode,
                clientId: body.clientId,
              });
              respondJson(res, 200, { success: true });
              return true;
            }
          }

          if (apiPath === '/connect') {
            if (req.method === 'POST') {
              gatewayService.connect();
              respondJson(res, 200, { success: true, message: 'Connecting...' });
              return true;
            }
          }

          if (apiPath === '/disconnect') {
            if (req.method === 'POST') {
              gatewayService.disconnect();
              respondJson(res, 200, { success: true });
              return true;
            }
          }

          if (apiPath === '/message/send') {
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              const result = await gatewayService.sendMessage(body.to, body.message);
              respondJson(res, 200, result);
              return true;
            }
          }

          if (apiPath === '/message/image') {
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              const result = await gatewayService.sendImage(body.to, body.imageUrl);
              respondJson(res, 200, result);
              return true;
            }
          }

          if (apiPath === '/raw') {
            if (req.method === 'POST') {
              const body = await parseJsonBody(req);
              const result = await gatewayService.send(body.method, body.params || {});
              respondJson(res, 200, result);
              return true;
            }
          }

          if (apiPath === '/contacts') {
            if (req.method === 'GET') {
              const result = await gatewayService.getContacts();
              respondJson(res, 200, result);
              return true;
            }
          }

          if (apiPath === '/conversations') {
            if (req.method === 'GET') {
              const result = await gatewayService.getConversations();
              respondJson(res, 200, result);
              return true;
            }
          }

          if (apiPath.startsWith('/stream')) {
            if (req.method === 'GET' && apiPath === '/stream') {
              const url = new URL(req.url || '/', 'http://localhost');
              const sessionKey = url.searchParams.get('session') || '*';

              respondSSE(res);

              const unsubscribe = gatewayService.subscribeToStream(
                sessionKey,
                (event) => {
                  sendSSE(res, 'message', event);
                },
              );

              req.on('close', () => {
                unsubscribe();
                res.end();
              });

              return true;
            }

            if (req.method === 'POST' && apiPath === '/stream/send') {
              const body = await parseJsonBody(req);
              const { to, message } = body;

              respondSSE(res);

              const sessionKey = to || '*';
              const unsubscribe = gatewayService.subscribeToStream(
                sessionKey,
                (event) => {
                  sendSSE(res, 'message', event);
                  if (event.type === 'final' || event.type === 'error' || event.type === 'aborted') {
                    unsubscribe();
                    res.end();
                  }
                },
              );

              try {
                await gatewayService.sendMessage(to, message, true);
              } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                sendSSE(res, 'error', { error });
                unsubscribe();
                res.end();
              }

              return true;
            }
          }

          return false;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          respondJson(res, 400, { error: message });
          return true;
        }
      },
    });
  },
});