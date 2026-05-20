const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');

const KEY = Buffer.from(
  '6f71a512b1e035eaab53d8be73120d3fb68a0ca346b9560aab3e5cdf753d5e98',
  'hex'
);

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function encode(obj) {
  const raw = JSON.stringify(obj);
  const csum = crc32(Buffer.from(raw, 'utf8'));
  const crcHex = csum.toString(16).toUpperCase().padStart(8, '0');
  return `${crcHex}#${raw}`;
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  const ivB64 = iv.toString('base64');
  const tagHex = tag.toString('hex');
  const ctHex = encrypted.toString('hex');
  return `${ivB64}::${tagHex}::${ctHex}`;
}

function decrypt(encrypted) {
  const [ivB64, tagHex, ctHex] = encrypted.split('::');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ct);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted;
}

const COLLECTORS = [
    ["fp2",          "100",       0.5, 3],
    ["browser",      "101",       0,   1],
    ["capabilities", "102",       2,   8],
    ["gpu",          "103",       3,   12],
    ["dnt",          "104",       0,   1],
    ["math",         "105",       0,   1],
    ["screen",       "106",       0,   1],
    ["navigator",    "107",       0,   1],
    ["auto",         "108",       0,   1],
    ["stealth",      "undefined", 1,   4],
    ["subtle",       "110",       0,   1],
    ["canvas",       "111",       80,  200],
    ["formdetector", "112",       0,   3],
    ["be",           "undefined", 0,   1],
];

function _r(lo, hi) {
    const val = Math.random() * (hi - lo) + lo;
    return Math.round(val * 10) / 10;
}

function buildMetrics(hasToken = false) {
    const collectors = COLLECTORS.map(([name, mid, lo, hi]) => [
        name,
        mid,
        _r(lo, hi)
    ]);

    const fpMetrics = Object.fromEntries(
        collectors.map(([name, , value]) => [name, Math.floor(value)])
    );

    const enc = _r(0.5, 3);
    const crypt = _r(2, 8);
    const coll = collectors.reduce((sum, [, , v]) => sum + v, 0);
    const acq = Math.round((coll + enc + crypt + _r(2, 6)) * 10) / 10;
    const chall = _r(2, 8);
    const cookie = _r(0.1, 1);
    const total = Math.round((acq + chall + cookie) * 10) / 10;

    const metrics = [
        { name: "2", value: enc, unit: "2" },
        ...collectors.map(([, mid, v]) => ({ name: mid, value: v, unit: "2" })),
        { name: "3", value: crypt, unit: "2" },
        { name: "7", value: hasToken ? 1 : 0, unit: "4" },
        { name: "1", value: acq, unit: "2" },
        { name: "4", value: chall, unit: "2" },
        { name: "5", value: cookie, unit: "2" },
        { name: "6", value: total, unit: "2" },
        { name: "8", value: 1, unit: "4" },
    ];

    return [metrics, fpMetrics];
}

const PLUGINS = [
    { name: "PDF Viewer",                 str: "PDF Viewer " },
    { name: "Chrome PDF Viewer",          str: "Chrome PDF Viewer " },
    { name: "Chromium PDF Viewer",        str: "Chromium PDF Viewer " },
    { name: "Microsoft Edge PDF Viewer",  str: "Microsoft Edge PDF Viewer " },
    { name: "WebKit built-in PDF",        str: "WebKit built-in PDF " },
];

const PLUGIN_STR = PLUGINS.map(p => p.str).join('');
const SCREEN = "1920-1080-1080-24-*-*-*";

const GPU_POOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'webgl.json'), 'utf8'));

const BASE_BINS = [
    14469,36,41,46,47,49,28,22,44,24,38,15,39,49,32,42,31,29,22,33,
    32,27,40,28,47,12,31,32,42,20,27,35,118,22,22,31,22,13,27,26,
    27,17,27,33,15,29,29,30,33,32,27,38,31,16,35,23,22,24,19,18,
    25,23,20,22,102,15,22,13,19,19,18,24,13,26,10,15,26,16,14,19,
    16,20,18,26,18,49,15,19,24,22,19,17,15,20,21,22,103,27,50,38,
    55,31,496,25,19,15,25,24,18,53,32,13,19,19,21,20,29,18,28,30,
    19,15,14,23,28,12,33,131,41,35,33,29,8,15,13,17,28,33,41,21,
    35,23,26,33,19,20,74,34,12,24,15,20,19,71,20,9,20,18,22,84,
    20,19,27,7,31,18,21,24,13,14,40,20,39,16,27,24,29,17,18,27,
    16,14,16,26,13,17,14,22,20,15,20,99,15,9,18,16,15,20,31,13,
    28,35,27,48,52,48,33,47,32,47,42,13,28,21,25,26,30,25,15,23,
    21,27,24,115,41,30,16,20,26,17,24,36,24,32,24,60,28,33,25,37,
    48,32,31,26,19,51,34,50,31,43,43,53,76,57,50,13659,
];

const MATH = {
    tan: "-1.4214488238747245",
    sin: "0.8178819121159085",
    cos: "-0.5753861119575491",
};

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _rand_canvas() {
    const bins = BASE_BINS.map(v => {
        if (v > 500) {
            return v + randInt(-200, 200);
        } else if (v > 80) {
            return v + randInt(-15, 15);
        } else {
            return Math.max(1, v + randInt(-3, 3));
        }
    });
    const hash = randInt(100000000, 999999999);
    return { hash, bins };
}

function build_signal(site, fp_metrics, ua) {
    const now = Date.now();
    const gpu = GPU_POOL[Math.floor(Math.random() * GPU_POOL.length)];
    const { hash: c_hash, bins: c_bins } = _rand_canvas();
    return {
        metrics: fp_metrics,
        start: now,
        flashVersion: null,
        plugins: PLUGINS,
        dupedPlugins: `${PLUGIN_STR}||${SCREEN}`,
        screenInfo: SCREEN,
        referrer: "",
        userAgent: ua,
        location: site,
        webDriver: false,
        capabilities: {
            css: {
                textShadow: 1,
                WebkitTextStroke: 1,
                boxShadow: 1,
                borderRadius: 1,
                borderImage: 1,
                opacity: 1,
                transform: 1,
                transition: 1,
            },
            js: {
                audio: true,
                geolocation: true,
                localStorage: "supported",
                touch: false,
                video: true,
                webWorker: true,
            },
            elapsed: fp_metrics.capabilities,
        },
        gpu: gpu,
        dnt: null,
        math: MATH,
        automation: {
            wd: { properties: { document: [], window: [], navigator: [] } },
            phantom: { properties: { window: [] } },
        },
        stealth: { t1: 0, t2: 0, i: 1, mte: 0, mtd: false },
        crypto: {
            crypto: 1,
            subtle: 1,
            encrypt: true,
            decrypt: true,
            wrapKey: true,
            unwrapKey: true,
            sign: true,
            verify: true,
            digest: true,
            deriveBits: true,
            deriveKey: true,
            getRandomValues: true,
            randomUUID: true,
        },
        canvas: {
            hash: c_hash,
            emailHash: null,
            histogramBins: c_bins,
        },
        formDetected: false,
        numForms: 0,
        numFormElements: 0,
        be: { si: false },
        end: now + 1,
        errors: [],
        version: "2.4.0",
        id: crypto.randomUUID(),
    };
}

const RE_CHAL_SAME = /(\/__challenge_[A-Za-z0-9]+\/[a-f0-9]+\/[a-f0-9]+)/;
const RE_CHAL_EXT = /(https:\/\/[a-z0-9]+\.[a-z0-9]+\.[a-z0-9-]+\.token\.awswaf\.com\/[^/\s"]+\/[^/\s"]+\/[^/\s"]+)/;
const RE_CHAL_SDK = /(https:\/\/[a-z0-9]+\.edge\.sdk\.awswaf\.com\/[a-z0-9]+\/[a-z0-9]+)\/challenge\.js/;
const RE_GOKU = /window\.gokuProps\s*=\s*(\{[^}]+\})/;

const ENDPOINT = {
    "HashcashScrypt":   "verify",
    "SHA256":           "verify",
    "NetworkBandwidth": "mp_verify",
};

const BWDTH_SIZES = { 1: 1024, 2: 10240, 3: 102400, 4: 1048576, 5: 10485760 };

const BRANDS = {
    0: '"Not/A)Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
    1: '"Not A(Brand";v="24", "Chromium";v="{v}", "Google Chrome";v="{v}"',
    2: '"Chromium";v="{v}", "Not(A:Brand";v="24", "Google Chrome";v="{v}"',
    3: '"Not:A-Brand";v="8", "Chromium";v="{v}", "Google Chrome";v="{v}"',
};

function _parse_ua(ua) {
    const m = ua.match(/Chrome\/(\d+)/);
    const ver = m ? m[1] : "144";
    const platform = ua.toLowerCase().includes("windows") ? "Windows" : "Linux";
    const brand = BRANDS[parseInt(ver) % 4].replace(/\{v\}/g, ver);
    return { brand, platform };
}

function _nav_headers(site, ua) {
    const { brand, platform } = _parse_ua(ua);
    return {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": brand,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": `"${platform}"`,
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": ua,
    };
}

function _api_headers(site, ua, same_origin = true) {
    const { brand, platform } = _parse_ua(ua);
    return {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "ect": "4g",
        "origin": site,
        "pragma": "no-cache",
        "priority": "u=1, i",
        "referer": `${site}/`,
        "sec-ch-ua": brand,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": `"${platform}"`,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": same_origin ? "same-origin" : "cross-site",
        "user-agent": ua,
    };
}

function _check_zeros(h, difficulty) {
    let z = 0;
    for (let i = 0; i < h.length; i++) {
        const b = h[i];
        if (b === 0) {
            z += 8;
        } else {
            for (let j = 7; j >= 0; j--) {
                if ((b & (1 << j)) === 0) {
                    z++;
                } else {
                    break;
                }
            }
            break;
        }
    }
    return z >= difficulty;
}

function _solve_pow(challenge_input, checksum, difficulty, ctype, memory = 128) {
    if (ctype === "HashcashScrypt") {
        const combined = challenge_input + checksum;
        const salt = Buffer.from(checksum, 'utf8');
        for (let n = 0; n < 100000000; n++) {
            const h = crypto.scryptSync(`${combined}${n}`, salt, 32, { N: memory, r: 8, p: 1 });
            if (_check_zeros(h, difficulty)) {
                return String(n);
            }
        }
    } else if (ctype === "SHA256") {
        const base = Buffer.from(challenge_input + checksum, 'utf8');
        for (let n = 0; n < 100000000; n++) {
            const h = crypto.createHash('sha256').update(base).update(String(n)).digest();
            if (_check_zeros(h, difficulty)) {
                return String(n);
            }
        }
    }
    return "0";
}

function _solve_bandwidth(difficulty) {
    const sz = BWDTH_SIZES[difficulty] || 1024;
    return Buffer.alloc(sz, 0).toString('base64');
}

// FIX 1: resp.data bukan resp.text() — axios tidak punya .text()
async function _discover(client, site, ua) {
    const resp = await client.get(site, { headers: _nav_headers(site, ua) });
    const html = resp.data; // FIXED: was resp.text()

    let m = RE_CHAL_SAME.exec(html);
    if (m) {
        return { chal_url: `${site}${m[1]}`, same: true, goku: null };
    }
    m = RE_CHAL_EXT.exec(html);
    if (!m) {
        m = RE_CHAL_SDK.exec(html);
    }
    if (m) {
        const chal_url = m[1];
        let goku = null;
        const gm = RE_GOKU.exec(html);
        if (gm) {
            try {
                goku = JSON.parse(gm[1]);
            } catch {
                // gokuProps malformed, skip
            }
        }
        return { chal_url, same: false, goku };
    }
    throw new Error("challenge URL not found");
}

function _prepare(site, ua, has_token) {
    const [metrics, fp_metrics] = buildMetrics(has_token);
    const fp = build_signal(`${site}/`, fp_metrics, ua);
    const encoded = encode(fp);
    const checksum = encoded.split("#")[0];
    const encrypted = encrypt(encoded);
    return { checksum, encrypted, metrics };
}

function _build_body(domain, challenge, solution, checksum, encrypted, metrics, existing_token = null, goku_props = null) {
    const d = {
        challenge,
        solution,
        signals: [{ name: "Zoey", value: { Present: encrypted } }],
        checksum,
        existing_token,
        client: "Browser",
        domain,
        metrics,
    };
    if (goku_props) {
        d.goku_props = goku_props;
    }
    return JSON.stringify(d);
}

function _build_multipart(domain, challenge, solution_data, checksum, encrypted, metrics, existing_token = null, goku_props = null) {
    const meta = {
        challenge,
        solution: null,
        signals: [{ name: "Zoey", value: { Present: encrypted } }],
        checksum,
        existing_token,
        client: "Browser",
        domain,
        metrics,
    };
    if (goku_props) {
        meta.goku_props = goku_props;
    }

    const boundary = "----WebKitFormBoundary" + crypto.randomBytes(8).toString('hex');
    const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="solution_data"\r\n\r\n${solution_data}`,
        `--${boundary}\r\nContent-Disposition: form-data; name="solution_metadata"\r\n\r\n${JSON.stringify(meta)}`,
        `--${boundary}--\r\n`,
    ];
    const body = parts.join("\r\n");
    const ct = `multipart/form-data; boundary=${boundary}`;
    return { body, ct };
}

// FIX 2: Tambah helper untuk inject cookies ke CookieJar
async function _inject_cookies(jar, site, cookies) {
    for (const [name, value] of Object.entries(cookies)) {
        await jar.setCookie(`${name}=${value}`, site);
    }
}

function _make_client(proxy = null) {
    const jar = new CookieJar();
    const options = {
        jar,
        withCredentials: true,
    };
    if (proxy) {
        options.httpsAgent = new HttpsProxyAgent(proxy);
        options.proxy = false;
    }
    const client = wrapper(axios.create(options));
    client.jar = jar;
    return client;
}

// FIX 3: Hapus param cookies — cookies dikelola CookieJar secara otomatis
async function _do_verify(client, chal_url, endpoint, body, hdrs, content_type) {
    const headers = { ...hdrs, "content-type": content_type };
    const resp = await client.post(`${chal_url}/${endpoint}`, body, { headers });
    return resp.data;
}

async function solveAwsWaf(site, ua, proxy = null, cookies = {}, client = null) {
    site = site.replace(/\/$/, "");
    const domain = site.split("//")[1].split("/")[0];

    if (!client) {
        client = _make_client(proxy);
    }

    // FIX 4: Inject cookies awal ke CookieJar, bukan diteruskan ke setiap request
    if (cookies && Object.keys(cookies).length > 0) {
        await _inject_cookies(client.jar, site, cookies);
    }

    const t0 = Date.now();

    const { chal_url, same, goku } = await _discover(client, site, ua);
    const hdrs = _api_headers(site, ua, same);
    let token = null;

    for (let round_idx = 0; round_idx < 2; round_idx++) {
        const has_token = round_idx > 0;
        const { checksum, encrypted, metrics } = _prepare(site, ua, has_token);

        const t_inp = Date.now();
        // FIX 5: Hapus param cookies dari client.get — sudah dikelola CookieJar
        const resp = await client.get(`${chal_url}/inputs?client=browser`, { headers: hdrs });
        const inp_latency = Math.round((Date.now() - t_inp) * 10) / 10;
        const inputs = resp.data;
        const challenge = inputs.challenge;
        const decoded = JSON.parse(Buffer.from(challenge.input, 'base64').toString('utf8'));
        const ctype = decoded.challenge_type || "";
        const difficulty = decoded.difficulty || 1;
        const memory = decoded.memory || 128;

        if (has_token) {
            metrics.unshift({ name: "0", value: inp_latency, unit: "2" });
        }

        const endpoint = ENDPOINT[ctype] || "verify";

        let result;
        if (ctype === "NetworkBandwidth") {
            const sol_data = _solve_bandwidth(difficulty);
            const { body, ct } = _build_multipart(domain, challenge, sol_data, checksum, encrypted, metrics, null, goku);
            // FIX 6: Sesuaikan signature _do_verify (hapus param cookies)
            result = await _do_verify(client, chal_url, endpoint, body, hdrs, ct);
        } else {
            const solution = _solve_pow(challenge.input, checksum, difficulty, ctype, memory);
            const body = _build_body(domain, challenge, solution, checksum, encrypted, metrics, null, goku);
            result = await _do_verify(client, chal_url, endpoint, body, hdrs, "text/plain;charset=UTF-8");
        }

        if (round_idx === 0) {
            token = result.token;
        } else {
            token = result.token || token;
        }
    }

      const timestamp = new Date().toISOString();

      return { success: true, site, ua, token, timestamp }
}

module.exports = { solveAwsWaf };