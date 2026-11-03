// One-shot entry points:
//   npm run generate -- "a paper boat in a storm"     MP4 video
//   npm run hero -- "drifting particles"              live animation for a website
// Runs the matching skill through the local Claude Code CLI, on your Claude Code login.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_TOOLS = [
  'Skill',
  'Read',
  'Glob',
  'Grep',
  'Edit(videos/**)', // also covers Write
  'Edit(heroes/**)',
  // Windows sessions may reach for either shell.
  'Bash(node src/render.mjs:*)',
  'PowerShell(node src/render.mjs:*)',
  'Bash(node src/hero.mjs:*)',
  'PowerShell(node src/hero.mjs:*)',
];

const args = process.argv.slice(2);
const skill = args[0] === '--hero' ? (args.shift(), 'hero') : 'video';
const prompt = args.join(' ').trim();
if (!prompt) {
  console.error(`Usage: npm run ${skill === 'hero' ? 'hero' : 'generate'} -- "what it should show"`);
  process.exit(1);
}

// Claude Code prefers an API key when one is set, which would bill per token.
// Removing it keeps this running on the Claude Code login, with no extra charges.
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;

const claude = spawn('claude', ['-p', `/${skill} ${prompt}`, '--allowedTools', ALLOWED_TOOLS.join(',')], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

claude.on('error', (error) => {
  console.error(error.code === 'ENOENT' ? 'Claude Code CLI not found on PATH.' : error.message);
  process.exit(1);
});
claude.on('close', (code) => process.exit(code ?? 1));
