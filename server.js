import express from 'express';
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.DWEETLIVE_USERNAME || 'dweetlive').replace(/^@/, '');
const ACCESS_TOKEN = process.env.DWEETLIVE_ACCESS_TOKEN || '';
const VIP_DIAMONDS = Math.max(1, Number(process.env.VIP_DIAMONDS || 100));
const RECONNECT_MS = Math.max(5000, Number(process.env.RECONNECT_MS || 15000));

const app = express();
app.use(express.static('public', { extensions: ['html'] }));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const screens = new Set();

const state = {
  service: 'DweetLive Gift Listener',
  username: USERNAME,
  tiktok: 'starting',
  startedAt: new Date().toISOString(),
  connectedAt: null,
  lastEventAt: null,
  lastError: null,
  totalEvents: 0
};

function tokenMatches(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function userFields(data) {
  const u = data?.user || {};
  const avatar = u.profilePicture?.url || u.profilePicture?.urls?.[0] ||
    u.avatarThumb?.urlList?.[0] || u.avatarThumb?.urls?.[0] ||
    u.avatarLarger?.urlList?.[0] || null;
  return {
    userId: String(u.userId || ''),
    uniqueId: String(u.uniqueId || ''),
    nickname: String(u.nickname || u.uniqueId || 'TikTok viewer'),
    avatar
  };
}

function broadcast(type, fields = {}) {
  const event = { id: randomUUID(), type, timestamp: new Date().toISOString(), ...fields };
  state.lastEventAt = event.timestamp;
  state.totalEvents += 1;
  const packet = JSON.stringify({ event: 'live.event', data: event });
  for (const client of screens) {
    if (client.readyState === WebSocket.OPEN) client.send(packet);
  }
  console.log(`[${type}]`, fields.nickname || '', fields.giftName || '');
}

function setTikTokStatus(status, extra = {}) {
  state.tiktok = status;
  const packet = JSON.stringify({
    event: 'connection.status',
    data: { status, username: USERNAME, timestamp: new Date().toISOString(), ...extra }
  });
  for (const client of screens) {
    if (client.readyState === WebSocket.OPEN) client.send(packet);
  }
}

function giftHandler(data) {
  const giftType = Number(data?.giftType ?? data?.giftDetails?.giftType ?? 0);
  const repeatEnd = data?.repeatEnd === true;
  const repeatCount = Math.max(1, Number(data?.repeatCount || 1));
  if (giftType === 1 && !repeatEnd) return;

  const giftName = data?.extendedGiftInfo?.name ||
    data?.giftDetails?.giftName || data?.giftName ||
    `Gift ${data?.giftId ?? ''}`.trim();
  const perGiftDiamonds = Number(
    data?.extendedGiftInfo?.diamondCount ??
    data?.giftDetails?.diamondCount ?? data?.diamondCount ?? 0
  );
  const diamonds = Math.max(0, perGiftDiamonds * repeatCount);
  const vip = diamonds >= VIP_DIAMONDS;

  broadcast('gift', {
    ...userFields(data), giftName, giftId: String(data?.giftId || ''),
    giftCount: repeatCount, diamonds, vip,
    card: {
      tier: vip ? 'vip' : 'standard',
      message: vip
        ? 'An incredible gift — you have earned VIP supporter status!'
        : 'Thank you for supporting this LIVE!'
    }
  });
}

function registerEvents(connection) {
  connection.on(WebcastEvent.GIFT, giftHandler);
  connection.on(WebcastEvent.CHAT, d => broadcast('chat', {
    ...userFields(d), comment: String(d?.comment || '').slice(0, 400)
  }));
  connection.on(WebcastEvent.LIKE, d => broadcast('like', {
    ...userFields(d), likeCount: Number(d?.likeCount || 1),
    totalLikeCount: Number(d?.totalLikeCount || 0),
    message: 'Thank you for the likes!'
  }));
  connection.on(WebcastEvent.FOLLOW, d => broadcast('follow', {
    ...userFields(d), message: 'Thanks for following!'
  }));
  connection.on(WebcastEvent.SHARE, d => broadcast('share', {
    ...userFields(d), message: 'Thank you for sharing the LIVE!'
  }));
  connection.on(WebcastEvent.MEMBER, d => broadcast('member', {
    ...userFields(d), viewerCount: Number(d?.memberCount || 0),
    message: 'Welcome to the LIVE!'
  }));
  connection.on(WebcastEvent.SUB_NOTIFY, d => broadcast('subscription', {
    ...userFields(d), message: 'Thank you for subscribing!'
  }));
  connection.on('error', err => {
    state.lastError = String(err?.message || err).slice(0, 300);
    console.error('[TikTok error]', state.lastError);
  });
  connection.on('disconnected', info => {
    console.log('[TikTok disconnected]', info || '');
    setTikTokStatus('disconnected');
  });
  connection.on(WebcastEvent.STREAM_END, () => {
    console.log('[TikTok] LIVE ended');
    setTikTokStatus('offline');
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function tiktokLoop() {
  let delay = RECONNECT_MS;
  while (true) {
    let connection;
    try {
      setTikTokStatus('connecting');
      console.log(`Connecting to public TikTok LIVE @${USERNAME}`);
      connection = new TikTokLiveConnection(USERNAME, {
        processInitialData: false,
        fetchRoomInfoOnConnect: true,
        enableExtendedGiftInfo: true
      });
      registerEvents(connection);
      const connected = await connection.connect();
      state.connectedAt = new Date().toISOString();
      state.lastError = null;
      delay = RECONNECT_MS;
      setTikTokStatus('connected', { roomId: String(connected?.roomId || '') });
      console.log('TikTok connection established.');
      await new Promise(resolve => {
        connection.once('disconnected', resolve);
        connection.once(WebcastEvent.STREAM_END, resolve);
      });
    } catch (err) {
      state.lastError = String(err?.message || err).slice(0, 300);
      console.error('[Connect failed]', state.lastError);
    } finally {
      setTikTokStatus('reconnecting');
      if (connection) {
        try { await connection.disconnect(); } catch {}
      }
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 120000);
  }
}

app.get('/health', (_req, res) => res.json({
  ok: true, service: state.service, time: new Date().toISOString()
}));
app.get('/status', (_req, res) => res.json({
  ...state, connectedScreens: screens.size, vipDiamonds: VIP_DIAMONDS
}));
app.get('/config', (_req, res) => res.json({
  username: USERNAME, vipDiamonds: VIP_DIAMONDS,
  websocketPath: '/live', tokenRequired: true
}));

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host}`); }
  catch { socket.destroy(); return; }
  if (url.pathname !== '/live' || !ACCESS_TOKEN ||
      !tokenMatches(url.searchParams.get('token'), ACCESS_TOKEN)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
  screens.add(ws);
  ws.isAlive = true;
  console.log(`Printer screen connected (${screens.size})`);
  ws.send(JSON.stringify({
    event: 'connection.status',
    data: { status: state.tiktok, username: USERNAME, timestamp: new Date().toISOString() }
  }));
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => {
    screens.delete(ws);
    console.log(`Printer screen disconnected (${screens.size})`);
  });
  ws.on('error', err => console.error('[Screen socket]', err.message));
});

const heartbeat = setInterval(() => {
  for (const ws of screens) {
    if (!ws.isAlive) { ws.terminate(); screens.delete(ws); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DweetLive listener listening on ${PORT}`);
  console.log(`TikTok account: @${USERNAME}; VIP threshold: ${VIP_DIAMONDS} diamonds`);
  if (!ACCESS_TOKEN) console.warn('Set DWEETLIVE_ACCESS_TOKEN before connecting a printer screen.');
  tiktokLoop().catch(err => {
    console.error('TikTok loop stopped unexpectedly:', err);
    process.exitCode = 1;
  });
});
server.on('close', () => clearInterval(heartbeat));
