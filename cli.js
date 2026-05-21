#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');
const { DeepSeekClient, DeepSeekError } = require('./deepseek');

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || __dirname, '.deepseek-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const C = {
  green: '\x1b[38;5;121m',
  cyan: '\x1b[38;5;159m',
  yellow: '\x1b[38;5;229m',
  red: '\x1b[38;5;204m',
  dim: '\x1b[38;5;244m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  magenta: '\x1b[38;5;213m',
  blue: '\x1b[38;5;117m',
  gray: '\x1b[38;5;240m',
  white: '\x1b[38;5;255m',
};

const S = {
  arrow: `${C.gray}│${C.reset}`,
  prompt: `${C.cyan}❯${C.reset}`,
  sep: `${C.gray}─${C.reset}`,
  ok: `${C.green}✔${C.reset}`,
  err: `${C.red}✘${C.reset}`,
  info: `${C.blue}ℹ${C.reset}`,
  warn: `${C.yellow}⚠${C.reset}`,
  agent: `${C.magenta}◈${C.reset}`,
  tool: `${C.cyan}⚙${C.reset}`,
  thought: `${C.gray}·${C.reset}`,
  done: `${C.green}✓${C.reset}`,
  fail: `${C.red}✗${C.reset}`,
  dot: `${C.gray}•${C.reset}`,
  chapter: `${C.blue}✦${C.reset}`,
};

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function drawBox(lines, width = 48) {
  const top = `  ${C.cyan}╔${'═'.repeat(width - 2)}╗${C.reset}`;
  const bottom = `  ${C.cyan}╚${'═'.repeat(width - 2)}╝${C.reset}`;
  const content = lines.map(line => {
    const visibleLen = stripAnsi(line).length;
    const padding = Math.max(0, width - 2 - visibleLen);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return `  ${C.cyan}║${C.reset}${' '.repeat(leftPad)}${line}${' '.repeat(rightPad)}${C.cyan}║${C.reset}`;
  });
  return [top, ...content, bottom].join('\n');
}

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
  const box = drawBox([
    `${C.bold}${C.white}DEEPSEEK${C.reset} ${C.magenta}AGENT CLI${C.reset} ${C.dim}v1.2${C.reset}`,
    `${C.dim}Professional autonomous coding assistant${C.reset}`
  ]);
  console.log('\n' + box + '\n');
}

function printHelp() {
  console.log(`
  ${C.bold}${C.white}Commands${C.reset}
  ${C.gray}──────────────────────────────────────────────${C.reset}
  ${C.cyan}login <email> <pass>${C.reset}    Login to DeepSeek
  ${C.cyan}token <token>${C.reset}           Set token manually
  ${C.cyan}logout${C.reset}                  Logout
  ${C.cyan}chat${C.reset}                    Regular chat mode
  ${C.cyan}coding${C.reset}                  Coding agent mode ${C.dim}(default)${C.reset}
  ${C.cyan}new${C.reset}                     New session
  ${C.cyan}thinking${C.reset}                Toggle thinking mode ${C.dim}(chat)${C.reset}
  ${C.cyan}search${C.reset}                  Toggle web search ${C.dim}(chat)${C.reset}
  ${C.cyan}help${C.reset}                    Show this screen
  ${C.cyan}exit${C.reset}                    Quit
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
      const out = lines.map(l => `  ${C.gray}│${C.reset} ${l}`).join('\n');
      return `\n${C.gray}  ╭─${lang ? ' ' + lang : ''}${C.reset}\n${out}\n${C.gray}  ╰──${C.reset}`;
    })
    .replace(/`([^`]+)`/g, `${C.yellow}$1${C.reset}`)
    .replace(/\*\*([^*]+)\*\*/g, `${C.bold}${C.white}$1${C.reset}`)
    .replace(/\*([^*]+)\*/g, `${C.dim}$1${C.reset}`)
    .replace(/^### (.*$)/gm, `${C.bold}${C.cyan}# $1${C.reset}`)
    .replace(/^## (.*$)/gm, `${C.bold}${C.cyan}## $1${C.reset}`)
    .replace(/^# (.*$)/gm, `${C.bold}${C.cyan}### $1${C.reset}`)
    .replace(/^- (.*$)/gm, ` ${C.gray}•${C.reset} $1`)
    .replace(/^> (.*$)/gm, ` ${C.gray}▎${C.reset}${C.dim}$1${C.reset}`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${C.cyan}$1${C.reset}${C.dim}($2)${C.reset}`);

  return result;
}

function formatAIResponse(text) {
  if (!text) return '';
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const AGENT_PROMPT = `You are a professional coding agent. You follow a strict Research -> Strategy -> Execution lifecycle.

## Workflow
1. **Research**: Map the codebase and validate assumptions using ls, glob, grep, and read.
2. **Strategy**: Formulate a grounded plan and share it with the user.
3. **Execution**: Apply surgical changes using write or edit. Verify with read or exec.

## Communication
- Use the **update_topic** tool whenever you change your logical phase (e.g., from Research to Execution).
- Use the **think** tool for step-by-step reasoning.
- Keep responses concise and focused on the task.
- Response in Indonesian.

## Tool Format
<TOOL_CALL>{"name":"tool_name","args":{...}}</TOOL_CALL>

## Available Tools
- **read** {filePath}
- **write** {filePath, content}
- **edit** {filePath, oldString, newString}
- **exec** {command}
- **glob** {pattern, cwd?}
- **grep** {pattern, path?}
- **ls** {path?}
- **todos** {action, items?}
- **think** {thought}
- **update_topic** {title, strategic_intent} — Start a new chapter of work.

Current Working Directory:`;

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
    const p = path.resolve(args.path || '.');
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
  update_topic: async (args) => {
    console.log(`\n  ${S.chapter} ${C.bold}${C.white}${args.title}${C.reset}`);
    console.log(`    ${C.dim}${args.strategic_intent}${C.reset}\n`);
    return `[OK] Topic updated: ${args.title}`;
  },
};

function parseSegments(text) {
  const segments = [];
  // More permissive regex to catch malformed tags like TOOL_CALL> (missing <)
  // Or cases where the AI is slightly inconsistent.
  const regex = /<?TOOL_CALL>([\s\S]*?)<\/TOOL_CALL>?/g;
  let lastIdx = 0;
  let match;

  // Pre-process thinking tags if they exist (DeepSeek often uses <think>...</think>)
  let processedText = text.replace(/<think>([\s\S]*?)<\/think>/g, (_, thought) => {
    return `<TOOL_CALL>{"name":"think","args":{"thought":${JSON.stringify(thought.trim())}}}</TOOL_CALL>`;
  });

  while ((match = regex.exec(processedText)) !== null) {
    const textBefore = processedText.slice(lastIdx, match.index);
    if (textBefore.trim()) {
      segments.push({ type: 'text', content: textBefore.trim() });
    }

    const rawTool = match[1].trim();
    try {
      const parsed = JSON.parse(rawTool);
      if (parsed.name && TOOLS[parsed.name]) {
        segments.push({ type: 'tool', name: parsed.name, args: parsed.args || {} });
      } else {
        segments.push({ type: 'text', content: match[0] });
      }
    } catch (e) {
      // Lenient parse
      try {
        const fixed = rawTool.replace(/\\"/g, '"').replace(/'/g, '"');
        const parsed = JSON.parse(fixed);
        if (parsed.name && TOOLS[parsed.name]) {
          segments.push({ type: 'tool', name: parsed.name, args: parsed.args || {} });
        } else {
          segments.push({ type: 'text', content: match[0] });
        }
      } catch (e2) {
        segments.push({ type: 'text', content: match[0] });
      }
    }
    lastIdx = regex.lastIndex;
  }

  const textAfter = processedText.slice(lastIdx);
  if (textAfter.trim()) {
    segments.push({ type: 'text', content: textAfter.trim() });
  }

  return segments;
}

async function promptConfirmation(seg, rl) {
  return new Promise(resolve => {
    console.log(`\n  ${C.yellow}Apply this change?${C.reset}`);
    if (seg.name === 'write') {
      console.log(`  ${C.dim}Action:${C.reset} ${C.green}write${C.reset} ${C.white}${seg.args.filePath}${C.reset}`);
    } else if (seg.name === 'edit') {
      console.log(`  ${C.dim}Action:${C.reset} ${C.yellow}edit${C.reset} ${C.white}${seg.args.filePath}${C.reset}`);
    } else if (seg.name === 'exec') {
      console.log(`  ${C.dim}Action:${C.reset} ${C.red}exec${C.reset} ${C.white}${seg.args.command}${C.reset}`);
    }
    
    console.log(`\n  ${C.blue}1.${C.reset} Allow once`);
    console.log(`  ${C.blue}2.${C.reset} Allow for this session`);
    console.log(`  ${C.blue}3.${C.reset} Modify with external editor`);
    console.log(`  ${C.blue}4.${C.reset} No, suggest changes (esc)`);
    
    rl.question(`\n  ${C.cyan}choice${C.reset} ${S.prompt} `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function modifyWithEditor(content) {
  const tmpFile = path.join(os.tmpdir(), `deepseek_edit_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, content);
  const editor = process.env.EDITOR || 'nano';
  try {
    execSync(`${editor} ${tmpFile}`, { stdio: 'inherit' });
    const newContent = fs.readFileSync(tmpFile, 'utf8');
    try { fs.unlinkSync(tmpFile); } catch {}
    return newContent;
  } catch (e) {
    console.log(`  ${S.fail} ${C.red}Editor failed: ${e.message}${C.reset}`);
    return content;
  }
}

async function codingChat(client, config, sessionId, userMessage, rl) {
  const systemMsg = `${AGENT_PROMPT} ${process.cwd()}\n\nUser request: ${userMessage}`;
  let currentMsg = systemMsg;
  let finalAnswer = '';
  const maxIter = 25;

  for (let iter = 0; iter < maxIter; iter++) {
    const result = await client.chat(sessionId, currentMsg, { search: false, thinking: false });
    const content = result.content || '';
    const segments = parseSegments(content);

    if (segments.length === 0) {
      finalAnswer = content;
      break;
    }

    let toolResultAccum = '';
    let hasActualTools = false;

    for (const seg of segments) {
      if (seg.type === 'text') {
        const rendered = renderMarkdown(seg.content);
        const lines = rendered.split('\n');
        console.log(`  ${S.agent} ${lines[0]}`);
        for (let i = 1; i < lines.length; i++) {
          console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
        }
      } else if (seg.type === 'tool') {
        if (seg.name === 'think') {
          const thought = seg.args.thought || '';
          if (thought.trim()) {
            console.log(`  ${S.thought} ${C.dim}${thought.trim()}${C.reset}`);
          }
          toolResultAccum += '[THOUGHT] Noted. Continue.\n';
        } else if (seg.name === 'update_topic') {
          const res = await TOOLS.update_topic(seg.args);
          toolResultAccum += `Tool result for update_topic:\n${res}\n`;
        } else {
          hasActualTools = true;
          if (['write', 'edit', 'exec'].includes(seg.name) && !global._sessionAllowed) {
            const choice = await promptConfirmation(seg, rl);
            if (choice === '2') {
              global._sessionAllowed = true;
            } else if (choice === '3') {
              if (seg.name === 'write') seg.args.content = await modifyWithEditor(seg.args.content);
              else if (seg.name === 'edit') seg.args.newString = await modifyWithEditor(seg.args.newString);
              else if (seg.name === 'exec') seg.args.command = await modifyWithEditor(seg.args.command);
            } else if (choice === '4' || choice === '') {
              console.log(`  ${S.warn} ${C.yellow}Action cancelled by user.${C.reset}`);
              toolResultAccum += `[ERROR] User rejected this ${seg.name} call.\n`;
              continue;
            }
          }

          const argsStr = JSON.stringify(seg.args);
          const displayArgs = argsStr.length > 80 ? argsStr.slice(0, 80) + '…' : argsStr;
          process.stdout.write(`  ${S.tool} ${C.cyan}${seg.name}${C.reset}(${C.dim}${displayArgs}${C.reset}) `);

          try {
            const toolResult = await TOOLS[seg.name](seg.args);
            const isError = toolResult.startsWith('[ERROR]');
            console.log(`${isError ? S.fail : S.done}`);
            if (toolResult && !toolResult.startsWith('[OK]') && !toolResult.startsWith('[THOUGHT]')) {
              const preview = toolResult.length > 1000 ? toolResult.slice(0, 1000) + '...' : toolResult;
              const lines = preview.split('\n');
              if (lines.length > 12) {
                for (let i = 0; i < 10; i++) console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
                console.log(`  ${C.gray}│${C.reset} ${C.dim}... (${lines.length - 10} more lines)${C.reset}`);
              } else {
                for (const line of lines) if (line.trim()) console.log(`  ${C.gray}│${C.reset} ${line}`);
              }
            }
            toolResultAccum += `Tool result for ${seg.name}:\n${toolResult}\n`;
          } catch (e) {
            console.log(`${S.fail}`);
            toolResultAccum += `[ERROR] ${seg.name}: ${e.message}\n`;
          }
        }
      }
    }

    if (!hasActualTools && toolResultAccum.includes('[THOUGHT]')) {
      currentMsg = toolResultAccum;
    } else if (hasActualTools || toolResultAccum.includes('[OK] Topic updated')) {
      currentMsg = toolResultAccum;
    } else {
      return null;
    }
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
    rl.question(`  ${C.magenta}agent${C.reset} ${S.prompt} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { ask(); return; }
      if (trimmed === '/exit' || trimmed === '/quit') { rl.close(); return; }
      try {
        const response = await codingChat(client, config, sessionId, trimmed, rl);
        if (response) {
          const rendered = renderMarkdown(response.trim());
          const lines = rendered.split('\n');
          console.log(`  ${S.agent} ${lines[0]}`);
          for (let i = 1; i < lines.length; i++) {
            console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
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
    return `  ${mode} ${S.prompt} `;
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
  ${C.bold}${C.white}Commands${C.reset}
  ${C.gray}──────────────────────────────────────────────${C.reset}
  ${C.cyan}/login <email> <pass>${C.reset}    Login
  ${C.cyan}/token <token>${C.reset}           Set token
  ${C.cyan}/logout${C.reset}                  Logout
  ${C.cyan}/chat${C.reset}                    Regular chat mode
  ${C.cyan}/coding${C.reset}                  Coding agent mode
  ${C.cyan}/new${C.reset}                     New session
  ${C.cyan}/thinking${C.reset}                Toggle thinking ${C.dim}(chat)${C.reset}
  ${C.cyan}/search${C.reset}                  Toggle web search ${C.dim}(chat)${C.reset}
  ${C.cyan}/help${C.reset}                    This screen
  ${C.cyan}/exit${C.reset}                    Quit
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
          const response = await codingChat(client, config, sessionId, trimmed, rl);
          if (response) {
            const rendered = renderMarkdown(response.trim());
            const lines = rendered.split('\n');
            console.log(`  ${S.agent} ${lines[0]}`);
            for (let i = 1; i < lines.length; i++) {
              console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
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
              console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
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
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const response = await codingChat(client, config, csId, msg, rl);
          rl.close();
          if (response) {
            const rendered = renderMarkdown(response.trim());
            const lines = rendered.split('\n');
            console.log(`  ${S.agent} ${lines[0]}`);
            for (let i = 1; i < lines.length; i++) {
              console.log(`  ${C.gray}│${C.reset} ${lines[i]}`);
            }
          }
        } else {
          console.log(`  ${S.info} ${C.magenta}agent mode${C.reset}  ${C.dim}/exit to quit${C.reset}`);
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const ask = () => {
            rl.question(`  ${C.magenta}agent${C.reset} ${S.prompt} `, async (input) => {
              if (input.trim() === '/exit') { rl.close(); return; }
              await codingChat(client, config, csId, input, rl);
              ask();
            });
          };
          ask();
        }
      }
      break;

    case '--help':
    case '-h':
      {
        const box = drawBox([
          `${C.bold}${C.white}DEEPSEEK${C.reset} ${C.magenta}AGENT CLI${C.reset} ${C.dim}— professional coding assistant${C.reset}`
        ]);
        console.log('\n' + box);
        console.log(`
  ${C.bold}${C.white}Usage${C.reset}
  ${C.gray}──────────────────────────────────────────────${C.reset}
  ${C.cyan}deepseek${C.reset}                        start interactive agent
  ${C.cyan}deepseek -m <text>${C.reset}              single chat
  ${C.cyan}deepseek -c <request>${C.reset}           coding agent (one-shot)
  ${C.cyan}deepseek --login <email> <pass>${C.reset}  login
  ${C.cyan}deepseek --token <token>${C.reset}         set token
  ${C.cyan}deepseek --logout${C.reset}                logout
  ${C.cyan}deepseek --help${C.reset}                  this screen
      `);
      }
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