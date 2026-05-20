'use strict';

const { DeepSeekClient } = require('./deepseek');

async function main() {
  const client = new DeepSeekClient();

  await client.login('xbotztechnology@gmail.com', 'guntur1204');
  console.log('Login berhasil!');

  const reply = await client.quickChat('Halo! Siapa kamu?');
  console.log('Reply:', reply.content);

  /*
  client.setToken('wO7or1dSLll6oTiwNysgAUXEE4UVMHzKB858x6YtsUV4GxL91Y2bLL1/LlUJy9XL');
  console.log('Token set!');

  const sessionId = await client.createSession();

  const r1 = await client.chat(sessionId, 'nama gw xai cuy');
  console.log('Turn 1:', r1.content);

  const r2 = await client.chat(sessionId, 'tadi nama gw siapa?');
  console.log('Turn 2:', r2.content);

  const fileId = await client.uploadFile('./foto.jpg', 'foto.jpg', 'image/jpeg');
  await client.waitForFile(fileId);
  const r3 = await client.chat(sessionId, 'ini gambar apa?', { fileIds: [fileId] });
  console.log('Chat + file:', r3.content);

  await client.logout();
  console.log('Done!');
  */
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
