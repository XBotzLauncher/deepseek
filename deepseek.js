'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');
const { solveAwsWaf } = require('./aws-waf-solver');

const BASE_URL = 'https://chat.deepseek.com';

const API = {
  LOGIN:          '/api/v0/users/login',
  LOGOUT:         '/api/v0/users/logout',
  POW_CHALLENGE:  '/api/v0/chat/create_pow_challenge',
  CREATE_SESSION: '/api/v0/chat_session/create',
  CHAT:           '/api/v0/chat/completion',
  UPLOAD_FILE:    '/api/v0/file/upload_file',
  FETCH_FILES:    '/api/v0/file/fetch_files',
  PREVIEW_FILE:   '/api/v0/file/preview',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

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
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const val  = pair.slice(idx + 1);
    if (name) cookies.set(name, val ?? '');
  }
}

function serializeCookies() {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

let authToken = null;

function buildHeaders(extra = {}) {
  const h = {
    'Accept': '*/*',
    'User-Agent': UA,
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'Accept-Language': 'en-US,en;q=0.9',
    'x-app-version': '2.0.0',
    'x-client-version': '2.0.0',
    'x-client-platform': 'web',
    'x-client-locale': 'en_US',
    'x-client-timezone-offset': '25200',
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
        if (res.statusCode >= 400) {
           let msg = `HTTP ${res.statusCode}`;
           try { const p = JSON.parse(raw); msg = p.message || msg; } catch {}
           return reject(new DeepSeekError(msg, `HTTP_${res.statusCode}`, raw));
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return resolve({ raw, _status: res.statusCode, _headers: res.headers }); }
        resolve({ ...parsed, _status: res.statusCode, _headers: res.headers });
      });
      res.on('error', reject);
    });

    req.on('error', err => reject(new DeepSeekError(err.message, err.code)));
    req.on('timeout', () => { req.destroy(); reject(new DeepSeekError('Request timeout', 'TIMEOUT')); });

    if (bodyBuf instanceof FormData) bodyBuf.pipe(req);
    else { if (bodyBuf) req.write(bodyBuf); req.end(); }
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
    wbg: { __wbindgen_throw: () => { throw new Error('wasm error'); } }
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
    const chPtr = passStr(ch);    const chLen = WLEN;
    const pfPtr = passStr(prefix); const pfLen = WLEN;
    wasm.wasm_solve(retptr, chPtr, chLen, pfPtr, pfLen, difficulty);
    const code   = getDV().getInt32(retptr,      true);
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
      // SSE lines start with 'data:'
      if (!line.startsWith('data:')) return;
      
      // Spec says 'data: ' (optional space)
      // We must be careful not to slice off significant characters
      let raw = line.slice(5);
      if (raw.startsWith(' ')) raw = raw.slice(1);
      
      if (raw === '[DONE]') return;
      if (!raw) return;
      
      try {
        const ev = JSON.parse(raw);
        if (ev.response_message_id) messageId = ev.response_message_id;
        if (ev.message_id) messageId = ev.message_id;

        // Path-based updates (p=path, v=value)
        if (ev.p !== undefined) {
          lastPath = ev.p;
          if (typeof ev.v === 'string' && ev.p.includes('/content') && !ev.p.includes('thinking')) {
            content += ev.v;
          }
          return;
        }

        // Value-only updates
        if (ev.v !== undefined && ev.o === undefined && ev.p === undefined) {
          if (typeof ev.v === 'string') {
            if (!lastPath || (lastPath.includes('/content') && !lastPath.includes('thinking'))) {
              content += ev.v;
            }
          }
          return;
        }

        // Legacy/Alternative fragment formats
        const fragments = ev.v?.response?.fragments ?? ev.choices?.[0]?.delta?.content;
        if (fragments) {
          if (Array.isArray(fragments)) {
            for (const frag of fragments) {
              if ((frag.type === 'RESPONSE' || frag.type === 'text') && typeof frag.content === 'string') {
                content += frag.content;
              }
            }
          } else if (typeof fragments === 'string') {
            content += fragments;
          }
          if (ev.v?.response?.message_id) messageId = ev.v.response.message_id;
        }
      } catch (err) {
        // If it's not valid JSON, it's either a partial JSON chunk or raw text
        // In SSE, 'data:' lines can be concatenated.
        // DeepSeek typically sends one JSON object per 'data:' line.
        // If parsing fails, we treat it as raw text to avoid losing characters.
        content += raw;
      }
    }

    stream.on('data', chunk => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n/);
      buf = lines.pop(); // Keep partial line in buffer
      for (const line of lines) {
        processLine(line);
      }
    });
    stream.on('end', () => {
      if (buf) processLine(buf);
      resolve({ content, message_id: messageId });
    });
    stream.on('error', err => reject(new DeepSeekError(err.message, 'STREAM_ERROR')));
  });
}

class DeepSeekClient {
  constructor({ proxy = null } = {}) {
    this._proxy = proxy;
    this._sessions = new Map();
    this._wafSolved = false;
  }

  setToken(token) {
    authToken = token;
  }

  async _ensureWaf() {
    if (this._wafSolved) return;
    const result = await solveAwsWaf(BASE_URL, UA, this._proxy);
    if (!result?.token) throw new DeepSeekError('WAF solve failed: no token', 'WAF_FAILED');
    cookies.set('aws-waf-token', result.token);
    this._wafSolved = true;
  }

  async login(email, password) {
    await this._ensureWaf();
    const loginBody = {
      email,
      mobile: '',
      password,
      area_code: '',
      device_id: 'B' + Buffer.from(crypto.randomBytes(48)).toString('base64'),
      os: 'web',
    };
    const res = await request('POST', API.LOGIN, { body: loginBody });
    if (res._status === 202 || res._headers?.['x-amzn-waf-action'] === 'challenge') {
      this._wafSolved = false;
      await this._ensureWaf();
      const retry = await request('POST', API.LOGIN, { body: loginBody });
      return this._extractToken(retry);
    }
    return this._extractToken(res);
  }

  _extractToken(res) {
    const token = res?.data?.biz_data?.user?.token ?? res?.data?.user?.token;
    if (!token) throw new DeepSeekError('Login failed: no token', 'AUTH_NO_TOKEN', res);
    authToken = token;
    return { ok: true, token };
  }

  async logout() {
    await request('POST', API.LOGOUT, { body: {} }).catch(() => {});
    authToken = null;
    this._wafSolved = false;
  }

  async createSession() {
    const res = await request('POST', API.CREATE_SESSION, { body: {} });
    const sessionId = res?.data?.biz_data?.chat_session?.id;
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
      model_type: 'default',
      prompt: message,
      ref_file_ids: opts.fileIds || [],
      thinking_enabled: opts.thinking || false,
      search_enabled: opts.search ?? true,
      preempt: false,
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
    const buffer = typeof filePathOrBuffer === 'string' ? fs.readFileSync(filePathOrBuffer) : filePathOrBuffer;
    if (!filename && typeof filePathOrBuffer === 'string') filename = path.basename(filePathOrBuffer);
    const powHeader = await getPowHeader(API.UPLOAD_FILE);
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });
    const res = await request('POST', API.UPLOAD_FILE, {
      body: form,
      headers: { ...form.getHeaders(), 'x-file-size': String(buffer.length), 'x-ds-pow-response': powHeader, 'x-thinking-enabled': '0' }
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