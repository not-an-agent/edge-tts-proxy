const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;

const EDGE_TTS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  '?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o));
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Edge TTS proxy is running.');
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  if (!isAllowed(origin)) {
    console.warn('Rejected:', origin);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    wss.emit('connection', clientWs, req);
  });
});

wss.on('connection', (clientWs) => {
  const edgeWs = new WebSocket(EDGE_TTS_URL, {
    headers: {
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    }
  });

  clientWs.on('message', (data) => {
    if (edgeWs.readyState === WebSocket.OPEN) edgeWs.send(data);
  });

  edgeWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  edgeWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
  });

  edgeWs.on('error', (err) => {
    console.error('Edge TTS error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1011, 'Upstream error');
  });

  clientWs.on('close', () => {
    if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(edgeWs.readyState)) edgeWs.close();
  });
});

server.listen(PORT, () => console.log(`Proxy on port ${PORT}`));