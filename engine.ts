/**
 * ShareKita transfer engine: QR pairing + direct TCP over the local network.
 *
 * Protocol (newline-delimited JSON headers, raw bytes for file bodies):
 *   receiver -> sender : {t:'hello', token}
 *   sender   -> receiver: {t:'manifest', files:[{id,name,size}]}
 *   receiver -> sender : {t:'get', id, offset}      (offset enables resume)
 *   sender   -> receiver: {t:'file', id, size, offset}\n <raw bytes>
 *   receiver -> sender : {t:'done'}
 */
import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import * as Network from 'expo-network';
import { Buffer } from 'buffer';
import { useStore } from './store';
import { safeName, stripScheme, uid } from './utils';

const PORT = 8899;
const CHUNK = 64 * 1024;
const RECEIVE_DIR = `${RNFS.DocumentDirectoryPath}/received`;

export interface PickedFile { name: string; size: number; uri: string }
export interface Offer { app: 'sharekita'; v: 1; ip: string; port: number; token: string }
interface Meta { id: string; name: string; size: number }

const send = (s: any, obj: object) => s.write(JSON.stringify(obj) + '\n');
const writeAsync = (s: any, data: Buffer) =>
  new Promise<void>((res, rej) => {
    try { s.write(data, undefined, (e?: Error) => (e ? rej(e) : res())); } catch (e) { rej(e); }
  });

/** Throttled progress reporter that also computes transfer speed. */
function makeProgress(id: string, startOffset: number) {
  const t0 = Date.now();
  let last = 0;
  return (pos: number, force = false) => {
    const now = Date.now();
    if (!force && now - last < 150) return;
    last = now;
    const speed = ((pos - startOffset) / Math.max(now - t0, 1)) * 1000;
    useStore.getState().upsert({ id, transferred: pos, speed, status: 'active' });
  };
}

/* ───────────────────────── SENDER ───────────────────────── */

export async function startSending(files: PickedFile[]) {
  const { upsert, setInfo } = useStore.getState();
  const ip = await Network.getIpAddressAsync();
  if (!ip || ip === '0.0.0.0') throw new Error('Connect to Wi-Fi (or enable a hotspot) first.');

  const token = uid() + uid();
  const metas: (Meta & { path: string })[] = files.map((f) => ({
    id: uid(), name: f.name, size: f.size, path: stripScheme(f.uri),
  }));
  metas.forEach((m) =>
    upsert({ id: m.id, name: m.name, size: m.size, transferred: 0, speed: 0,
             status: 'pending', direction: 'send', path: m.path }));

  const server = TcpSocket.createServer((socket: any) => {
    let buf = Buffer.alloc(0);
    let authed = false;
    let chain: Promise<void> = Promise.resolve();

    const handle = async (msg: any) => {
      if (msg.t === 'hello') {
        if (msg.token !== token) { socket.destroy(); return; }
        authed = true;
        setInfo('Receiver connected');
        send(socket, { t: 'manifest', files: metas.map(({ id, name, size }) => ({ id, name, size })) });
      } else if (authed && msg.t === 'get') {
        const m = metas.find((x) => x.id === msg.id);
        if (!m) return;
        const offset = Math.min(Math.max(msg.offset || 0, 0), m.size);
        send(socket, { t: 'file', id: m.id, size: m.size, offset });
        const progress = makeProgress(m.id, offset);
        try {
          let pos = offset;
          while (pos < m.size) {
            const len = Math.min(CHUNK, m.size - pos);
            const b64 = await RNFS.read(m.path, len, pos, 'base64');
            await writeAsync(socket, Buffer.from(b64, 'base64'));
            pos += len;
            progress(pos);
          }
          progress(m.size, true);
          upsert({ id: m.id, status: 'done', speed: 0, transferred: m.size });
        } catch {
          upsert({ id: m.id, status: 'interrupted', speed: 0 });
        }
      } else if (msg.t === 'done') {
        setInfo('All files sent ✔');
        socket.destroy();
      }
    };

    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      let i;
      while ((i = buf.indexOf(10)) >= 0) {
        const line = buf.subarray(0, i).toString('utf8');
        buf = buf.subarray(i + 1);
        try { const msg = JSON.parse(line); chain = chain.then(() => handle(msg)); } catch {}
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      metas.forEach((m) => {
        const it = useStore.getState().items[m.id];
        if (it?.status === 'active') upsert({ id: m.id, status: 'interrupted', speed: 0 });
      });
    });
  });

  server.listen({ port: PORT, host: '0.0.0.0' });
  const offer: Offer = { app: 'sharekita', v: 1, ip, port: PORT, token };
  return { payload: JSON.stringify(offer), stop: () => server.close() };
}

/* ───────────────────────── RECEIVER ───────────────────────── */

export function parseOffer(data: string): Offer | null {
  try {
    const o = JSON.parse(data);
    return o?.app === 'sharekita' && o.ip && o.port && o.token ? o : null;
  } catch { return null; }
}

export async function receiveFrom(offer: Offer): Promise<() => void> {
  const { upsert, setInfo } = useStore.getState();
  await RNFS.mkdir(RECEIVE_DIR);

  let files: Meta[] = [];
  let idx = -1;
  let buf = Buffer.alloc(0);
  let mode: 'header' | 'body' = 'header';
  let cur: { meta: Meta; remaining: number; written: number; part: string; progress: ReturnType<typeof makeProgress> } | null = null;
  let io: Promise<void> = Promise.resolve(); // serialises disk writes
  let finished = false;

  const partPath = (m: Meta) => `${RECEIVE_DIR}/${safeName(m.name)}.${m.size}.part`;

  const requestNext = async (socket: any) => {
    idx++;
    if (idx >= files.length) {
      finished = true;
      send(socket, { t: 'done' });
      setInfo('All files received ✔');
      return;
    }
    const m = files[idx];
    const part = partPath(m);
    let offset = 0;
    if (await RNFS.exists(part)) offset = Number((await RNFS.stat(part)).size); // resume
    send(socket, { t: 'get', id: m.id, offset });
  };

  const socket: any = TcpSocket.createConnection({ host: offer.ip, port: offer.port }, () => {
    setInfo('Connected');
    send(socket, { t: 'hello', token: offer.token });
  });

  const finishFile = async () => {
    if (!cur) return;
    const { meta, part } = cur;
    await io;
    let final = `${RECEIVE_DIR}/${safeName(meta.name)}`;
    if (await RNFS.exists(final)) final = `${RECEIVE_DIR}/${Date.now()}_${safeName(meta.name)}`;
    await RNFS.moveFile(part, final);
    useStore.getState().upsert({ id: meta.id, status: 'done', speed: 0, transferred: meta.size, path: final });
    cur = null;
    mode = 'header';
    await requestNext(socket);
    pump(); // there may already be buffered data for the next header
  };

  const pump = () => {
    for (;;) {
      if (mode === 'header') {
        const i = buf.indexOf(10);
        if (i < 0) return;
        let msg: any;
        try { msg = JSON.parse(buf.subarray(0, i).toString('utf8')); } catch { msg = {}; }
        buf = buf.subarray(i + 1);

        if (msg.t === 'manifest') {
          files = msg.files;
          files.forEach((m) =>
            upsert({ id: m.id, name: m.name, size: m.size, transferred: 0, speed: 0,
                     status: 'pending', direction: 'receive' }));
          requestNext(socket);
        } else if (msg.t === 'file') {
          const meta = files.find((f) => f.id === msg.id)!;
          cur = {
            meta, remaining: msg.size - msg.offset, written: msg.offset,
            part: partPath(meta), progress: makeProgress(meta.id, msg.offset),
          };
          if (msg.offset === 0) io = io.then(() => RNFS.writeFile(cur!.part, '', 'utf8'));
          mode = 'body';
          if (cur.remaining === 0) { finishFile(); return; }
        }
      } else if (cur) {
        if (!buf.length) return;
        const n = Math.min(buf.length, cur.remaining);
        const chunk = buf.subarray(0, n);
        buf = buf.subarray(n);
        cur.remaining -= n;
        cur.written += n;
        const c = cur, b64 = Buffer.from(chunk).toString('base64'), pos = c.written;
        io = io.then(async () => { await RNFS.appendFile(c.part, b64, 'base64'); c.progress(pos); });
        if (cur.remaining === 0) { finishFile(); return; }
      }
    }
  };

  socket.on('data', (d: Buffer) => { buf = Buffer.concat([buf, d]); pump(); });
  socket.on('error', () => setInfo('Connection problem — scan again to resume.'));
  socket.on('close', () => {
    if (finished) return;
    const st = useStore.getState();
    st.order.forEach((id) => {
      if (st.items[id].status === 'active') upsert({ id, status: 'interrupted', speed: 0 });
    });
    setInfo('Transfer interrupted. Scan the QR again to resume where it stopped.');
  });

  return () => socket.destroy();
}
