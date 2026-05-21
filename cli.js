#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DeepSeekClient, DeepSeekError } = require('./deepseek');

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || __dirname, '.deepseek-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const { execSync } = require('child_process');

const C = {
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const S = {
  arrow: `${C.dim}┃${C.reset}`,
  prompt: `${C.cyan}┃${C.reset}`,
  sep: `${C.dim}─${C.reset}`,
  ok: `${C.green}◆${C.reset}`,
  err: `${C.red}▲${C.reset}`,
  info: `${C.blue}●${C.reset}`,
  warn: `${C.yellow}■${C.reset}`,
  agent: `${C.green}◈${C.reset}`,
  tool: `${C.magenta}▸${C.reset}`,
  thought: `${C.dim}·${C.reset}`,
  done: `${C.green}✓${C.reset}`,
  fail: `${C.red}✗${C.reset}`,
};

function loadConfig() {
  const localCfg = path.join(__dirname, 'config.json');
  const paths = [localCfg, CONFIG_FILE];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return {};
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error(`  ${S.warn} ${C.yellow}config:${C.reset} ${e.message}`);
  }
}

function printBanner() {
  console.log(`
${C.cyan}  ┌─────────────────────────────────────┐${C.reset}
${C.cyan}  │${C.reset}  ${C.bold}${C.green}AlfiXD CLI${C.reset}${C.dim} v1.0 — Coding Agent${C.reset}  ${C.cyan}│${C.reset}
${C.cyan}  │${C.reset}  ${C.dim}autonomous terminal assistant${C.reset}     ${C.cyan}│${C.reset}
${C.cyan}  └─────────────────────────────────────┘${C.reset}
`);
}

function printHelp() {
  console.log(`
  ${C.bold}${C.cyan}commands${C.reset}
  ${C.dim}  ─────────────────────────────────────${C.reset}
  ${C.green}  login <email> <pass>${C.reset}    Login to DeepSeek
  ${C.green}  token <token>${C.reset}           Set token manually
  ${C.green}  logout${C.reset}                  Logout
  ${C.green}  chat${C.reset}                    Regular chat mode
  ${C.green}  coding${C.reset}                  Coding agent mode ${C.dim}(default)${C.reset}
  ${C.green}  new${C.reset}                     New session
  ${C.green}  thinking${C.reset}                Toggle thinking mode ${C.dim}(chat only)${C.reset}
  ${C.green}  search${C.reset}                  Toggle web search ${C.dim}(chat only)${C.reset}
  ${C.green}  help${C.reset}                    Show this screen
  ${C.green}  exit${C.reset}                    Quit
`);
}

async function initClient(config) {
  const client = new DeepSeekClient(config.proxy ? { proxy: config.proxy } : {});
  if (config.token) {
    client.setToken(config.token);
  }
  return client;
}

async function ensureLogin(client, config) {
  if (config.token) return true;
  if (config.email && config.password) {
    try {
      process.stdout.write(`  ${C.dim}authenticating${C.reset}... `);
      const r = await client.login(config.email, config.password);
      config.token = r.token;
      saveConfig(config);
      console.log(`${C.green}connected${C.reset}`);
      return true;
    } catch (e) {
      console.log(`\n  ${S.fail} ${C.red}${e.message}${C.reset}`);
      return false;
    }
  }
  return false;
}

async function loginFlow(client, config, email, password) {
  process.stdout.write(`  ${C.dim}logging in${C.reset}... `);
  const result = await client.login(email, password);
  config.token = result.token;
  config.email = email;
  saveConfig(config);
  console.log(`${C.green}done${C.reset}`);
  return result;
}

function renderMarkdown(text) {
  if (!text) return '';
  let result = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  result = result
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const lines = code.trimEnd().split('\n');
      const out = lines.map(l => `  ${C.dim}│${C.reset} ${l}`).join('\n');
      return `\n${C.dim}  ┌─${lang ? ' ' + lang : ''}${C.reset}\n${out}\n${C.dim}  └──${C.reset}`;
    })
    .replace(/`([^`]+)`/g, `${C.yellow}$1${C.reset}`)
    .replace(/\*\*([^*]+)\*\*/g, `${C.bold}$1${C.reset}`)
    .replace(/\*([^*]+)\*/g, `${C.dim}$1${C.reset}`)
    .replace(/^### (.*$)/gm, `${C.bold}${C.cyan}$1${C.reset}`)
    .replace(/^## (.*$)/gm, `${C.bold}${C.cyan}$1${C.reset}`)
    .replace(/^# (.*$)/gm, `${C.bold}${C.cyan}$1${C.reset}`)
    .replace(/^- (.*$)/gm, ` ${C.dim}•${C.reset} $1`)
    .replace(/^> (.*$)/gm, ` ${C.dim}▎${C.reset}${C.dim}$1${C.reset}`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${C.cyan}$1${C.reset}${C.dim}($2)${C.reset}`);

  return result.trim();
}

function formatAIResponse(text) {
  if (!text) return '';
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const AGENT_PROMPT = `You are an autonomous coding agent. Your job is to complete the user's request by thinking step-by-step and using tools.

## Core Rules
1. Plan before acting — think about what needs to be done
2. Use tools to explore, read, write, and execute
3. If a tool errors, diagnose and try a different approach
4. When done, summarize what you did
5. Always respond in Indonesian to the user

## Tool Format
To call a tool, output EXACTLY:
<TOOL_CALL>
{"name":"tool_name","args":{...}}
</TOOL_CALL>

You can call ONE tool at a time. After each call I will execute it and give you the result.

## Available Tools
- **read** {filePath} — Read file contents
- **write** {filePath, content} — Write/overwrite file
- **edit** {filePath, oldString, newString} — Replace exact text in file
- **exec** {command} — Run shell command (timeout 30s)
- **glob** {pattern, cwd?} — Find files by glob pattern
- **grep** {pattern, path?} — Search file contents
- **ls** {path?} — List directory contents
- **todos** {action, items?} — Manage task list. Actions: "add", "done", "list", "clear"
- **think** {thought} — Show your reasoning to the user

## Workflow
1. Start with <TOOL_CALL>{"name":"think","args":{"thought":"..."}}</TOOL_CALL>
2. Explore the codebase with glob/grep/ls/read
3. Plan changes, then execute with write/edit/exec
4. Track progress with todos
5. Verify changes with read/exec
6. Give final summary

Working directory:`;

const TOOLS = {
  read: async (args) => {
    const p = path.resolve(args.filePath);
    if (!fs.existsSync(p)) return `[ERROR] File not found: ${p}`;
    return fs.readFileSync(p, 'utf8');
  },
  write: async (args) => {
    const p = path.resolve(args.filePath);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, args.content);
    return `[OK] Written ${Buffer.byteLength(args.content, 'utf8')} bytes to ${p}`;
  },
  edit: async (args) => {
    const p = path.resolve(args.filePath);
    if (!fs.existsSync(p)) return `[ERROR] File not found: ${p}`;
    const content = fs.readFileSync(p, 'utf8');
    if (!content.includes(args.oldString)) return `[ERROR] oldString not found in ${p}`;
    const newContent = content.replace(args.oldString, args.newString);
    fs.writeFileSync(p, newContent);
    return `[OK] Edited ${p} (${content.length} -> ${newContent.length} chars)`;
  },
  exec: async (args) => {
    try {
      const output = execSync(args.command, { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 * 10 });
      return output || '[OK] Command completed (no output)';
    } catch (e) {
      return `[ERROR] ${e.message}\n${e.stdout || ''}\n${e.stderr || ''}`.trim();
    }
  },
  glob: async (args) => {
    const cwd = args.cwd || process.cwd();
    try {
      const result = execSync(`find ${cwd} -name "${args.pattern}" 2>/dev/null | head -300`, { encoding: 'utf8', timeout: 15000 });
      const files = result.trim().split('\n').filter(Boolean).map(f => f.replace(cwd + '/', ''));
      return files.length ? files.join('\n') : '[OK] No files matched';
    } catch (e) {
      return `[ERROR] ${e.message}`;
    }
  },
  grep: async (args) => {
    const p = args.path || process.cwd();
    try {
      const result = execSync(`grep -rn "${args.pattern}" ${p} 2>/dev/null | head -100`, { encoding: 'utf8', timeout: 15000 });
      return result.trim() || '[OK] No matches';
    } catch (e) {
      return `[ERROR] ${e.message}`;
    }
  },
  ls: async (args) => {
    const p = args.path || '.';
    try {
      const items = fs.readdirSync(p);
      const details = items.map(name => {
        const full = path.join(p, name);
        const stat = fs.statSync(full);
        const type = stat.isDirectory() ? 'dir' : stat.isFile() ? 'file' : 'other';
        const size = stat.isFile() ? `(${stat.size}b)` : '';
        return `${type === 'dir' ? '/' : ''}${name} ${size}`;
      });
      return details.join('\n') || '(empty)';
    } catch (e) {
      return `[ERROR] ${e.message}`;
    }
  },
  todos: async (args) => {
    if (!global._todos) global._todos = [];
    switch (args.action) {
      case 'add':
        const items = Array.isArray(args.items) ? args.items : [args.items];
        items.forEach(item => global._todos.push({ task: item, done: false }));
        return `[TODO] Added ${items.length} item(s). Total: ${global._todos.length}`;
      case 'done':
        const idx = (args.index !== undefined) ? args.index : global._todos.length - 1;
        if (global._todos[idx]) { global._todos[idx].done = true; return `[TODO] Done: ${global._todos[idx].task}`; }
        return `[ERROR] No todo at index ${idx}`;
      case 'list':
        return global._todos.map((t, i) => `${t.done ? '[✓]' : '[ ]'} ${i}. ${t.task}`).join('\n') || '(no todos)';
      case 'clear':
        global._todos = [];
        return '[TODO] Cleared';
      default:
        return `[ERROR] Unknown action: ${args.action}. Use: add, done, list, clear`;
    }
  },
  think: async (args) => {
    return `[THOUGHT] ${args.thought}`;
  },
};

function parseToolCalls(text) {
  const calls = [];
  const regex = /<TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && TOOLS[parsed.name]) {
        calls.push(parsed);
      }
    } catch {}
  }
  return calls;
}

async function codingChat(client, config, sessionId, userMessage) {
  const systemMsg = `${AGENT_PROMPT} ${process.cwd()}\n\nUser request: ${userMessage}`;
  let currentMsg = systemMsg;
  let finalAnswer = '';
  const maxIter = 25;

  for (let iter = 0; iter < maxIter; iter++) {
    const result = await client.chat(sessionId, currentMsg, { search: false, thinking: false });
    const content = result.content || '';
    const toolCalls = parseToolCalls(content);

    if (toolCalls.length === 0) {
      finalAnswer = content;
      break;
    }

    const textBefore = content.split(/<TOOL_CALL>/)[0] || '';
    if (textBefore.trim()) {
      const rendered = renderMarkdown(textBefore.trim());
      const lines = rendered.split('\n');
      console.log(`  ${S.agent} ${lines[0]}`);
      for (let i = 1; i < lines.length; i++) {
        console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
      }
    }

    let toolResultAccum = '';
    for (const tc of toolCalls) {
      const argsStr = JSON.stringify(tc.args);
      const displayArgs = argsStr.length > 60 ? argsStr.slice(0, 60) + '…' : argsStr;

      if (tc.name === 'think') {
        process.stdout.write(`  ${S.thought} `);
        const thought = tc.args.thought || '';
        console.log(`${C.dim}${thought}${C.reset}`);
        toolResultAccum += '[THOUGHT] Noted. Continue with your plan.\n';
        continue;
      }

      process.stdout.write(`  ${S.tool} ${C.cyan}${tc.name}${C.reset}(${C.dim}${displayArgs}${C.reset}) `);

      try {
        const toolResult = await TOOLS[tc.name](tc.args);
        const isError = toolResult.startsWith('[ERROR]');
        console.log(`${isError ? S.fail : S.done}`);

        if (toolResult && !toolResult.startsWith('[OK]') && !toolResult.startsWith('[THOUGHT]')) {
          const preview = toolResult.length > 300 ? toolResult.slice(0, 300) + '...' : toolResult;
          const lines = preview.split('\n');
          if (lines.length > 8) {
            for (let i = 0; i < 6; i++) console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
            console.log(`  ${C.dim}│${C.reset} ${C.dim}... (${lines.length - 6} more lines)${C.reset}`);
          } else {
            for (const line of lines) console.log(`  ${C.dim}│${C.reset} ${line}`);
          }
        }
        toolResultAccum += `Tool result for ${tc.name}:\n${toolResult}\n`;
      } catch (e) {
        console.log(`${S.fail}`);
        toolResultAccum += `[ERROR] ${tc.name}: ${e.message}\n`;
      }
    }

    currentMsg = toolResultAccum || '[OK] All tools completed.';
  }

  return finalAnswer;
}

async function codingInteractive(client, config, sessionId) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  const ask = () => {
    rl.question(`  ${C.magenta}agent${C.reset} ${C.dim}⊳${C.reset} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }
      if (trimmed === '/exit' || trimmed === '/quit') { rl.close(); return; }

      try {
        const response = await codingChat(client, config, sessionId, trimmed);
        if (response) {
          const rendered = renderMarkdown(response.trim());
          const lines = rendered.split('\n');
          console.log(`  ${S.agent} ${lines[0]}`);
          for (let i = 1; i < lines.length; i++) {
            console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
          }
        }
      } catch (err) {
        console.log(`  ${S.fail} ${C.red}${err.message}${C.reset}`);
      }

      ask();
    });
  };

  ask();
}

async function codingMode(client, config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  let sessionId = null;
  let isCoding = true;

  const loggedIn = await ensureLogin(client, config);
  if (loggedIn) {
    sessionId = await client.createSession();
    console.log(`  ${S.ok} ${C.green}agent ready${C.reset} ${C.dim}· ${config.email || ''}${C.reset}\n`);
  } else {
    console.log(`  ${S.warn} ${C.yellow}not logged in — use${C.reset} ${C.green}/login${C.reset} ${C.yellow}to connect${C.reset}\n`);
  }

  const promptLabel = () => {
    const mode = isCoding ? `${C.magenta}agent${C.reset}` : `${C.cyan}chat${C.reset}`;
    return `  ${mode} ${C.dim}⊳${C.reset} `;
  };

  const ask = () => {
    rl.question(promptLabel(), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }

      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        switch (cmd) {
          case 'exit':
          case 'quit':
            rl.close();
            return;

          case 'help':
            console.log(`
  ${C.cyan}commands${C.reset}
  ${C.dim}  ─────────────────────────────────────${C.reset}
  ${C.green}  login <email> <pass>${C.reset}    login
  ${C.green}  token <token>${C.reset}           set token
  ${C.green}  logout${C.reset}                  logout
  ${C.green}  chat${C.reset}                    regular chat mode
  ${C.green}  coding${C.reset}                  coding agent mode
  ${C.green}  new${C.reset}                     new session
  ${C.green}  thinking${C.reset}                toggle thinking ${C.dim}(chat)${C.reset}
  ${C.green}  search${C.reset}                  toggle web search ${C.dim}(chat)${C.reset}
  ${C.green}  help${C.reset}                    this screen
  ${C.green}  exit${C.reset}                    quit
            `);
            break;

          case 'login':
            if (args.length < 2) {
              console.log(`  ${S.warn} ${C.yellow}usage: /login <email> <password>${C.reset}`);
            } else {
              try {
                await loginFlow(client, config, args[0], args.slice(1).join(' '));
                sessionId = await client.createSession();
                console.log(`  ${S.ok} ${C.green}session ready${C.reset}`);
              } catch (err) {
                console.log(`  ${S.fail} ${C.red}${err.message}${C.reset}`);
              }
            }
            break;

          case 'token':
            if (args.length < 1) {
              console.log(`  ${S.warn} ${C.yellow}usage: /token <token>${C.reset}`);
            } else {
              config.token = args[0];
              client.setToken(args[0]);
              saveConfig(config);
              sessionId = await client.createSession();
              console.log(`  ${S.ok} ${C.green}token stored${C.reset}`);
            }
            break;

          case 'logout':
            try { await client.logout(); } catch {}
            config.token = null;
            delete config.token;
            saveConfig(config);
            sessionId = null;
            console.log(`  ${S.info} ${C.blue}logged out${C.reset}`);
            break;

          case 'chat':
            isCoding = false;
            if (!sessionId && config.token) sessionId = await client.createSession();
            console.log(`  ${S.info} ${C.cyan}chat mode${C.reset}`);
            break;

          case 'coding':
            isCoding = true;
            if (!sessionId && config.token) sessionId = await client.createSession();
            console.log(`  ${S.info} ${C.magenta}agent mode${C.reset}`);
            break;

          case 'new':
          case 'session':
            if (!config.token) {
              console.log(`  ${S.warn} ${C.yellow}login first${C.reset}`);
            } else {
              sessionId = await client.createSession();
              console.log(`  ${S.ok} ${C.green}new session${C.reset}`);
            }
            break;

          default:
            console.log(`  ${S.warn} ${C.yellow}unknown command: /${cmd}${C.reset}`);
        }

        ask();
        return;
      }

      if (!config.token) {
        console.log(`  ${S.warn} ${C.yellow}login first — use /login <email> <password>${C.reset}`);
        ask();
        return;
      }

      try {
        if (isCoding) {
          const response = await codingChat(client, config, sessionId, trimmed);
          if (response) {
            const rendered = renderMarkdown(response.trim());
            const lines = rendered.split('\n');
            console.log(`  ${S.agent} ${lines[0]}`);
            for (let i = 1; i < lines.length; i++) {
              console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
            }
          }
        } else {
          let result;
          if (!sessionId) {
            result = await client.quickChat(trimmed, { search: false });
          } else {
            result = await client.chat(sessionId, trimmed, { search: false });
          }
          const response = formatAIResponse(result.content);
          if (response) {
            const rendered = renderMarkdown(response);
            const lines = rendered.split('\n');
            console.log(`  ${C.cyan}◈${C.reset} ${lines[0]}`);
            for (let i = 1; i < lines.length; i++) {
              console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
            }
          }
        }
      } catch (err) {
        console.log(`\n  ${S.fail} ${C.red}${err.message}${C.reset}`);
        if (err.message.includes('401') || err.message.includes('Unauthorized')) {
          config.token = null;
          saveConfig(config);
          console.log(`  ${S.warn} ${C.yellow}session expired — re-login required${C.reset}`);
        }
      }

      ask();
    });
  };

  ask();
}

async function interactiveMode(client, config) {
  await codingMode(client, config);
}

async function singleChat(client, config, message, opts = {}) {
  const ok = await ensureLogin(client, config);
  if (!ok) {
    console.error(`  ${S.warn} ${C.yellow}not logged in — use --login or set email/password in config.json${C.reset}`);
    process.exit(1);
  }

  try {
    const result = await client.quickChat(message, {
      thinking: opts.thinking || false,
      search: opts.search !== false,
    });
    const response = formatAIResponse(result.content);
    if (response) console.log(renderMarkdown(response));
  } catch (err) {
    console.error(`  ${S.fail} ${C.red}${err.message}${C.reset}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const client = await initClient(config);

  if (args.length === 0) {
    printBanner();
    await interactiveMode(client, config);
    return;
  }

  const flag = args[0];

  switch (flag) {
    case '--login':
    case '-l':
      if (args.length < 3) {
        console.error(`  ${S.warn} ${C.yellow}usage: deepseek --login <email> <password>${C.reset}`);
        process.exit(1);
      }
      try {
        await loginFlow(client, config, args[1], args.slice(2).join(' '));
      } catch (err) {
        console.error(`  ${S.fail} ${C.red}${err.message}${C.reset}`);
        process.exit(1);
      }
      break;

    case '--token':
    case '-t':
      if (!args[1]) {
        console.error(`  ${S.warn} ${C.yellow}usage: deepseek --token <token>${C.reset}`);
        process.exit(1);
      }
      config.token = args[1];
      client.setToken(args[1]);
      saveConfig(config);
      console.log(`  ${S.ok} ${C.green}token stored${C.reset}`);
      break;

    case '--logout':
      try { await client.logout(); } catch {}
      config.token = null;
      saveConfig(config);
      console.log(`  ${S.info} ${C.blue}logged out${C.reset}`);
      break;

    case '--message':
    case '-m':
      if (!args[1]) {
        console.error(`  ${S.warn} ${C.yellow}usage: deepseek --message <text>${C.reset}`);
        process.exit(1);
      }
      await singleChat(client, config, args[1]);
      break;

    case '--thinking':
      await singleChat(client, config, args.slice(1).join(' '), { thinking: true });
      break;

    case '--coding':
    case '-c':
      {
        const ok = await ensureLogin(client, config);
        if (!ok) {
          console.error(`  ${S.warn} ${C.yellow}not logged in${C.reset}`);
          process.exit(1);
        }
        const csId = await client.createSession();
        const msg = args.slice(1).join(' ');
        if (msg) {
          const response = await codingChat(client, config, csId, msg);
          if (response) {
            const rendered = renderMarkdown(response.trim());
            const lines = rendered.split('\n');
            console.log(`  ${S.agent} ${lines[0]}`);
            for (let i = 1; i < lines.length; i++) {
              console.log(`  ${C.dim}│${C.reset} ${lines[i]}`);
            }
          }
        } else {
          console.log(`  ${S.info} ${C.magenta}agent mode${C.reset}  ${C.dim}/exit to quit${C.reset}`);
          await codingInteractive(client, config, csId);
        }
      }
      break;

    case '--help':
    case '-h':
      console.log(`
  ${C.cyan}┌────────────────────────────────────────────┐${C.reset}
  ${C.cyan}│${C.reset}  ${C.bold}${C.green}DeepSeek CLI${C.reset} ${C.dim}— coding agent${C.reset}          ${C.cyan}│${C.reset}
  ${C.cyan}└────────────────────────────────────────────┘${C.reset}

  ${C.bold}${C.cyan}usage${C.reset}
  ${C.dim}  ──────────────────────────────────────────${C.reset}
  ${C.green}  deepseek${C.reset}                        start interactive agent
  ${C.green}  deepseek -m <text>${C.reset}              single chat
  ${C.green}  deepseek -c <request>${C.reset}           coding agent (one-shot)
  ${C.green}  deepseek --login <email> <pass>${C.reset}  login
  ${C.green}  deepseek --token <token>${C.reset}         set token
  ${C.green}  deepseek --logout${C.reset}                logout
  ${C.green}  deepseek --help${C.reset}                  this screen
      `);
      break;

    default:
      if (!flag.startsWith('--') && !flag.startsWith('-')) {
        await singleChat(client, config, args.join(' '));
      } else {
        console.error(`  ${S.warn} ${C.yellow}unknown flag: ${flag}${C.reset}`);
        process.exit(1);
      }
  }
}

main().catch(err => {
  console.error(`  ${S.fail} ${C.red}${err.message}${C.reset}`);
  process.exit(1);
});
