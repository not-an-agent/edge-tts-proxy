// worker.js — Edge TTS WebSocket proxy as a Cloudflare Worker
// Deploy with: wrangler deploy

const EDGE_TTS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  '?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

export default {
  async fetch(request, env) {

    // ── Origin check ────────────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);

    if (allowed.length > 0 && !allowed.some(o => origin === o || origin.startsWith(o))) {
      return new Response('Forbidden', { status: 403 });
    }

    // ── Must be a WebSocket upgrade ─────────────────────────────────────────
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Edge TTS proxy is running.', { status: 200 });
    }

    // ── Open connection to Edge TTS ─────────────────────────────────────────
    const edgeResponse = await fetch(EDGE_TTS_URL, {
      headers: {
        'Upgrade': 'websocket',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      },
    });

    const edgeWs = edgeResponse.webSocket;
    if (!edgeWs) {
      return new Response('Failed to connect to Edge TTS', { status: 502 });
    }
    edgeWs.accept();

    // ── Create client-facing WebSocket pair ─────────────────────────────────
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    // Browser → Edge TTS
    server.addEventListener('message', ({ data }) => {
      if (edgeWs.readyState === WebSocket.OPEN) edgeWs.send(data);
    });

    // Edge TTS → Browser
    edgeWs.addEventListener('message', ({ data }) => {
      if (server.readyState === WebSocket.OPEN) server.send(data);
    });

    server.addEventListener('close', ({ code, reason }) => {
      try { edgeWs.close(code, reason); } catch (_) {}
    });

    edgeWs.addEventListener('close', ({ code, reason }) => {
      try { server.close(code, reason); } catch (_) {}
    });

    edgeWs.addEventListener('error', () => {
      try { server.close(1011, 'Upstream error'); } catch (_) {}
    });

    server.addEventListener('error', () => {
      try { edgeWs.close(1011, 'Client error'); } catch (_) {}
    });

    return new Response(null, { status: 101, webSocket: client });
  },
};
