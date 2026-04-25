# deepseek

Unofficial Node.js client untuk [DeepSeek Chat](https://chat.deepseek.com) — reverse-engineered dari web API-nya langsung. Mendukung login, multi-turn conversation, upload file, dan thinking mode.

> ⚠️ **Disclaimer:** Library ini menggunakan internal API DeepSeek yang tidak resmi. Bisa berubah sewaktu-waktu tanpa pemberitahuan. Gunakan dengan bijak dan sesuai ToS DeepSeek.

---

## ✨ Fitur

- 🔐 Login & logout dengan email/password
- 💬 Single chat (`quickChat`) dan multi-turn conversation per session
- 🧠 DeepSeek Thinking mode (R1-style)
- 🔍 Web search toggle
- 📎 Upload file & kirim ke chat
- 🔒 Proof-of-Work (PoW) otomatis via WASM
- 🍪 Cookie & token management otomatis

---

## 📦 Instalasi

```bash
git clone https://github.com/XBotzLauncher/deepseek.git
cd deepseek
npm install
```

**Dependencies:**
- `form-data` — untuk upload file
- `sha3_wasm.wasm` — sudah include di repo (digunakan untuk PoW solving)

---

## 🚀 Quick Start

### Chat Cepat (Single Turn)

```js
const { DeepSeekClient } = require('./deepseek');

const client = new DeepSeekClient();

await client.login('email@example.com', 'password');

const reply = await client.quickChat('Halo! Siapa kamu?');
console.log(reply.content);

await client.logout();
```

---

### Multi-Turn Conversation

```js
const client = new DeepSeekClient();
await client.login('email@example.com', 'password');

const sessionId = await client.createSession();

const r1 = await client.chat(sessionId, 'Nama gw Budi');
console.log(r1.content);

const r2 = await client.chat(sessionId, 'Tadi nama gw siapa?');
console.log(r2.content); // "Nama kamu Budi"

await client.logout();
```

---

### Upload File + Chat

```js
const sessionId = await client.createSession();

const fileId = await client.uploadFile('./foto.jpg', 'foto.jpg', 'image/jpeg');
await client.waitForFile(fileId); // tunggu sampai file diproses

const reply = await client.chat(sessionId, 'Ini gambar apa?', { fileIds: [fileId] });
console.log(reply.content);
```

---

## 📖 API Reference

### `new DeepSeekClient()`
Buat instance client baru.

---

### `client.login(email, password)`
Login ke DeepSeek.

| Param | Type | Keterangan |
|-------|------|------------|
| `email` | `string` | Email akun DeepSeek |
| `password` | `string` | Password akun |

**Returns:** `{ ok: true, token: string }`

---

### `client.logout()`
Logout dan hapus token.

---

### `client.createSession()`
Buat sesi chat baru.

**Returns:** `string` — `sessionId`

---

### `client.chat(sessionId, message, opts?)`
Kirim pesan dalam sesi tertentu (mendukung multi-turn).

| Param | Type | Default | Keterangan |
|-------|------|---------|------------|
| `sessionId` | `string` | — | ID sesi dari `createSession()` |
| `message` | `string` | — | Pesan yang dikirim |
| `opts.thinking` | `boolean` | `true` | Aktifkan thinking mode |
| `opts.search` | `boolean` | `false` | Aktifkan web search |
| `opts.fileIds` | `string[]` | `[]` | ID file yang sudah diupload |

**Returns:** `{ content: string, message_id: string }`

---

### `client.quickChat(message, opts?)`
Shortcut: buat sesi baru + langsung chat dalam satu langkah.

**Returns:** `{ content: string, message_id: string }`

---

### `client.uploadFile(filePathOrBuffer, filename, mimeType?)`
Upload file ke DeepSeek.

| Param | Type | Keterangan |
|-------|------|------------|
| `filePathOrBuffer` | `string \| Buffer` | Path file atau Buffer |
| `filename` | `string` | Nama file |
| `mimeType` | `string` | MIME type (default: `application/octet-stream`) |

**Returns:** `string` — `fileId`

---

### `client.waitForFile(fileId, opts?)`
Polling sampai file selesai diproses server DeepSeek.

| Param | Type | Default | Keterangan |
|-------|------|---------|------------|
| `fileId` | `string` | — | ID file dari `uploadFile()` |
| `opts.maxAttempts` | `number` | `10` | Maksimal percobaan |
| `opts.intervalMs` | `number` | `2000` | Jeda antar percobaan (ms) |

---

## ❌ Error Handling

Semua error dilempar sebagai instance `DeepSeekError`:

```js
try {
  await client.login('wrong@email.com', 'wrongpass');
} catch (err) {
  console.log(err.name);    // "DeepSeekError"
  console.log(err.message); // pesan error
  console.log(err.code);    // kode error, e.g. "AUTH_NO_TOKEN", "TIMEOUT"
  console.log(err.data);    // raw response dari server (jika ada)
}
```

**Kode error umum:**

| Code | Keterangan |
|------|------------|
| `AUTH_NO_TOKEN` | Login gagal, token tidak ditemukan |
| `SESSION_CREATE_FAILED` | Gagal membuat sesi chat |
| `POW_FAILED` | Gagal solve Proof-of-Work |
| `FILE_NOT_FOUND` | File ID tidak ditemukan |
| `FILE_TIMEOUT` | File tidak selesai diproses sebelum timeout |
| `TIMEOUT` | Request timeout (30 detik) |
| `STREAM_ERROR` | Error saat baca SSE stream |
| `HTTP_4xx` / `HTTP_5xx` | HTTP error dari server |

---

## 📁 Struktur File

```
deepseek/
├── deepseek.js       # Core client library
├── sha3_wasm.wasm    # WASM binary untuk PoW (jangan dihapus)
├── tes.js            # Contoh penggunaan
└── package.json
```

---

## 📝 Lisensi

MIT