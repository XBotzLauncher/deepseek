'use strict';

const { DeepSeekClient } = require('./deepseek');

async function main() {
  const client = new DeepSeekClient();

  await client.login('example@gmail.com', 'xai123');
  console.log('Login berhasil!');

  const reply = await client.quickChat('Halo! Siapa kamu?');
  console.log('Reply:', reply.content);

  /*
  const sessionId = await client.createSession();

  const r1 = await client.chat(sessionId, 'nama gw xai cuy');
  console.log('Turn 1:', r1.content);

  const r2 = await client.chat(sessionId, 'tadi nama gw siapa?');
  console.log('Turn 2:', r2.content);

  const fileId = await client.uploadFile('./foto.jpg', 'foto.jpg', 'image/jpeg');
  await client.waitForFile(fileId);
  const r3 = await client.chat(sessionId, 'ini gambar apa?', { fileIds: [fileId] });
  console.log('Chat + file:', r3.content);
  */

  await client.logout();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
