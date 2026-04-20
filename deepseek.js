'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');

const BASE_URL = 'https://chat.deepseek.com';

const API = {
  LOGIN:         '/api/v0/users/login',
  LOGOUT:        '/api/v0/users/logout',
  POW_CHALLENGE: '/api/v0/chat/create_pow_challenge',
  CREATE_SESSION:'/api/v0/chat_session/create',
  CHAT:          '/api/v0/chat/completion',
  UPLOAD_FILE:   '/api/v0/file/upload_file',
  FETCH_FILES:   '/api/v0/file/fetch_files',
  PREVIEW_FILE:  '/api/v0/file/preview',
};

class DeepSeekError extends Error {
  constructor(message, code = 'UNKNOWN', data = null) {
    super(message);
    this.name = 'DeepSeekError';
    this.code = code;
    this.data = data;
  }
}

const cookies = new Map();

function setCookies(raw) {
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const [pair] = c.split(';');
    const [name, val] = pair.split('=');
    if (name) cookies.set(name.trim(), val ?? '');
  }
}

function serializeCookies() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

let authToken = null;

function buildHeaders(extra = {}) {
  const h = {
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    'x-app-version': '20241129.1',
    'x-client-platform': 'web',
    'x-client-locale': 'en_US',
  };
  const c = serializeCookies();
  if (c) h['Cookie'] = c;
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return Object.assign(h, extra);
}

function request(method, urlPath, { body, headers: extraHeaders = {} } = {}) {
  return new Promise((resolve, reject) => {
    let bodyBuf = null;
    const contentHeaders = {};

    if (body instanceof FormData) {
      bodyBuf = body;
      Object.assign(contentHeaders, body.getHeaders());
    } else if (body) {
      const json = JSON.stringify(body);
      bodyBuf = Buffer.from(json);
      contentHeaders['Content-Type'] = 'application/json';
      contentHeaders['Content-Length'] = bodyBuf.length;
    }

    const headers = buildHeaders({ ...contentHeaders, ...extraHeaders });
    const url = new URL(`${BASE_URL}${urlPath}`);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 30000,
    }, res => {
      if (res.headers['set-cookie']) setCookies(res.headers['set-cookie']);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return resolve({ raw }); }
        if (res.statusCode >= 400 || (parsed.code !== undefined && parsed.code !== 0)) {
          return reject(new DeepSeekError(
            parsed.msg || parsed.message || `HTTP ${res.statusCode}`,
            parsed.code || `HTTP_${res.statusCode}`,
            parsed
          ));
        }
        resolve(parsed);
      });
      res.on('error', reject);
    });

    req.on('error', err => reject(new DeepSeekError(err.message, err.code)));
    req.on('timeout', () => { req.destroy(); reject(new DeepSeekError('Request timeout', 'TIMEOUT')); });

    if (bodyBuf instanceof FormData) {
      bodyBuf.pipe(req);
    } else {
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    }
  });
}

function streamRequest(urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const headers = buildHeaders({
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      ...extraHeaders,
    });
    const url = new URL(`${BASE_URL}${urlPath}`);
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers }, res => {
      if (res.headers['set-cookie']) setCookies(res.headers['set-cookie']);
      if (res.statusCode >= 400) return reject(new DeepSeekError(`HTTP ${res.statusCode}`, `HTTP_${res.statusCode}`));
      resolve(res);
    });
    req.on('error', err => reject(new DeepSeekError(err.message, err.code)));
    req.write(bodyStr);
    req.end();
  });
}

let _wasmInstance = null;

async function loadWasm() {
  if (_wasmInstance) return _wasmInstance;
  const wasmPath = path.join(__dirname, 'sha3_wasm.wasm');
  const wasmBuf = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBuf, {
    wbg: { __wbindgen_throw: (ptr, len) => { throw new Error('wasm error'); } }
  });
  _wasmInstance = instance.exports;
  return _wasmInstance;
}

async function solvePoW(challenge) {
  const { algorithm, challenge: ch, salt, difficulty, signature, expire_at, expireAt } = challenge;
  const expiry = expireAt ?? expire_at;
  const prefix = `${salt}_${expiry}_`;

  const wasm = await loadWasm();
  const memory = wasm.memory;

  let cachedUint8 = null;
  const getUint8 = () => {
    if (!cachedUint8 || cachedUint8.buffer !== memory.buffer)
      cachedUint8 = new Uint8Array(memory.buffer);
    return cachedUint8;
  };
  let cachedDV = null;
  const getDV = () => {
    if (!cachedDV || cachedDV.buffer !== memory.buffer)
      cachedDV = new DataView(memory.buffer);
    return cachedDV;
  };

  const encoder = new TextEncoder();
  let WLEN = 0;
  function passStr(str) {
    const buf = encoder.encode(str);
    const ptr = wasm.__wbindgen_export_0(buf.length, 1) >>> 0;
    getUint8().subarray(ptr, ptr + buf.length).set(buf);
    WLEN = buf.length;
    return ptr;
  }

  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const chPtr = passStr(ch);   const chLen = WLEN;
    const pfPtr = passStr(prefix); const pfLen = WLEN;
    wasm.wasm_solve(retptr, chPtr, chLen, pfPtr, pfLen, difficulty);
    const code   = getDV().getInt32(retptr,     true);
    const answer = getDV().getFloat64(retptr + 8, true);
    if (code === 0) throw new DeepSeekError('PoW: no solution found', 'POW_FAILED');
    return { algorithm, challenge: ch, salt, answer: Math.round(answer), signature };
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

async function getPowHeader(targetPath) {
  const res = await request('POST', API.POW_CHALLENGE, { body: { target_path: targetPath } });
  const challenge = res?.data?.biz_data?.challenge ?? res?.data?.challenge;
  const pow = await solvePoW(challenge);
  return Buffer.from(JSON.stringify({ ...pow, target_path: targetPath })).toString('base64');
}

function parseSSEStream(stream) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let content = '';
    let messageId = null;

    let lastPath = null;

    function processLine(line) {
      if (!line.startsWith('data:')) return;
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') return;
      try {
        const ev = JSON.parse(raw);
        const v = ev.v;
        const p = ev.p;
        const o = ev.o;

        if (ev.response_message_id) messageId = ev.response_message_id;

        if (p !== undefined) lastPath = p;

        if (typeof v === 'string') {
          const isContent = lastPath === 'response/content' ||
                            (p !== undefined && p.includes('/content') && !p.includes('thinking'));
          if (isContent) content += v;
        }
      } catch {}
    }

    stream.on('data', chunk => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) processLine(line.trim());
    });

    stream.on('end', () => {
      if (buf.trim()) processLine(buf.trim());
      resolve({ content, message_id: messageId });
    });

    stream.on('error', err => reject(new DeepSeekError(err.message, 'STREAM_ERROR')));
  });
}

class DeepSeekClient {
  constructor() {
    this._deviceId = crypto.randomUUID();
    this._sessions = new Map();
  }

  async login(email, password) {
    const res = await request('POST', API.LOGIN, {
      body: { email, password, device_id: this._deviceId, os: 'web', locale: 'en_US' }
    });
    const token = res?.data?.biz_data?.user?.token;
    if (!token) throw new DeepSeekError('Login failed: no token', 'AUTH_NO_TOKEN');
    authToken = token;
    return { ok: true, token };
  }

  async logout() {
    await request('POST', API.LOGOUT, { body: {} }).catch(() => {});
    authToken = null;
  }

  async createSession() {
    const res = await request('POST', API.CREATE_SESSION, { body: {} });
    const sessionId = res?.data?.biz_data?.id;
    if (!sessionId) throw new DeepSeekError('Failed to create session', 'SESSION_CREATE_FAILED');
    this._sessions.set(sessionId, { lastMessageId: null });
    return sessionId;
  }

  async chat(sessionId, message, opts = {}) {
    const powHeader = await getPowHeader(API.CHAT);
    const session = this._sessions.get(sessionId) || { lastMessageId: null };

    const stream = await streamRequest(API.CHAT, {
      chat_session_id: sessionId,
      parent_message_id: session.lastMessageId,
      prompt: message,
      ref_file_ids: opts.fileIds || [],
      thinking_enabled: opts.thinking !== false,
      search_enabled: opts.search || false,
    }, { 'X-Ds-Pow-Response': powHeader });

    const result = await parseSSEStream(stream);
    session.lastMessageId = result.message_id;
    this._sessions.set(sessionId, session);

    return result;
  }

  async quickChat(message, opts = {}) {
    const sessionId = await this.createSession();
    return this.chat(sessionId, message, opts);
  }

  async uploadFile(filePathOrBuffer, filename, mimeType = 'application/octet-stream') {
    const buffer = typeof filePathOrBuffer === 'string'
      ? fs.readFileSync(filePathOrBuffer)
      : filePathOrBuffer;
    if (!filename && typeof filePathOrBuffer === 'string') filename = path.basename(filePathOrBuffer);

    const powHeader = await getPowHeader(API.UPLOAD_FILE);
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });

    const res = await request('POST', API.UPLOAD_FILE, {
      body: form,
      headers: {
        ...form.getHeaders(),
        'x-file-size': String(buffer.length),
        'x-ds-pow-response': powHeader,
        'x-thinking-enabled': '0',
      }
    });

    return res?.data?.biz_data?.id || res?.data?.id;
  }

  async waitForFile(fileId, { maxAttempts = 10, intervalMs = 2000 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await request('GET', `${API.FETCH_FILES}?file_ids=${fileId}`);
      const file = (res?.data?.biz_data?.files || [])[0];
      if (!file) throw new DeepSeekError('File not found', 'FILE_NOT_FOUND');
      if (file.status === 'SUCCESS' || file.error_code) return file;
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new DeepSeekError('File processing timeout', 'FILE_TIMEOUT');
  }
}

module.exports = { DeepSeekClient, DeepSeekError };
