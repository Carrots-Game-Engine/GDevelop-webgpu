#!/usr/bin/env node
/**
 * Run a command with a V8 heap large enough to bundle the editor.
 *
 * `react-app-rewired start` (and `build`) compile the whole editor, its
 * extensions and three.js at once. With the default Node.js heap (~2 GB on
 * 64-bit), the compilation gets to 2 GB and dies with:
 *
 *     FATAL ERROR: Ineffective mark-compacts near heap limit
 *     Allocation failed - JavaScript heap out of memory
 *
 * `NODE_OPTIONS` cannot reliably be set from an npm script on Windows, so this
 * small wrapper sets it and starts the command in a child process (the options
 * are then inherited by everything the command starts, like the file watcher of
 * the game engine runtime).
 *
 * Usage: node scripts/run-with-more-memory.js <command> [args...]
 * Override the heap size with GD_IDE_HEAP_MB (in megabytes).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const command = process.argv[2];
const commandArguments = process.argv.slice(3);

if (!command) {
  console.error(
    'Usage: node scripts/run-with-more-memory.js <command> [args...]'
  );
  process.exit(1);
}

const DEFAULT_MAX_HEAP_MB = 4096;
const MAX_HEAP_MB = 8192;

const getDefaultHeapSize = () => {
  const totalMemoryMb = os.totalmem() / (1024 * 1024);
  // Keep a margin for the OS, the browser and the other processes: a heap
  // larger than the machine would only make the system swap.
  const suggestedHeapMb = Math.floor((totalMemoryMb * 0.6) / 512) * 512;
  return Math.min(Math.max(suggestedHeapMb, DEFAULT_MAX_HEAP_MB), MAX_HEAP_MB);
};

const requestedHeapMb = parseInt(process.env.GD_IDE_HEAP_MB || '', 10);
const heapSizeMb =
  Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
    ? requestedHeapMb
    : getDefaultHeapSize();

const nodeOptions = [
  process.env.NODE_OPTIONS || '',
  `--max-old-space-size=${heapSizeMb}`,
]
  .filter(Boolean)
  .join(' ');

const binariesPath = path.join(process.cwd(), 'node_modules', '.bin');
const environment = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
  // Allow running a command of `node_modules/.bin` even when this script is
  // started directly (`node scripts/run-with-more-memory.js ...`) instead of
  // through an npm script.
  PATH: `${binariesPath}${path.delimiter}${process.env.PATH || ''}`,
};

/**
 * Run a command of `node_modules` with Node.js itself, so that no shell is
 * needed (and no argument is ever interpreted by one).
 */
const getNodeScriptPath = commandName => {
  try {
    const packageJsonPath = require.resolve(`${commandName}/package.json`, {
      paths: [process.cwd()],
    });
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const bin = packageJson.bin;
    const relativeBinPath =
      typeof bin === 'string' ? bin : bin && bin[commandName];
    if (!relativeBinPath) return null;
    const binPath = path.resolve(path.dirname(packageJsonPath), relativeBinPath);
    return fs.existsSync(binPath) ? binPath : null;
  } catch (error) {
    return null;
  }
};

console.log(
  `ℹ️  Running "${[command, ...commandArguments].join(
    ' '
  )}" with a ${heapSizeMb} MB heap (set GD_IDE_HEAP_MB to change it).`
);

const quoteForShell = argument =>
  /[\s"]/.test(argument) ? JSON.stringify(argument) : argument;

const nodeScriptPath = getNodeScriptPath(command);
const childProcess = nodeScriptPath
  ? spawn(process.execPath, [nodeScriptPath, ...commandArguments], {
      stdio: 'inherit',
      env: environment,
    })
  : process.platform === 'win32'
  ? spawn(
      [command, ...commandArguments].map(quoteForShell).join(' '),
      // A single command string: on Windows, a `.cmd` can only be run by a
      // shell, but passing the arguments as an array to a shell is unsafe.
      { stdio: 'inherit', shell: true, env: environment }
    )
  : spawn(command, commandArguments, {
      stdio: 'inherit',
      env: environment,
    });

const forwardSignal = signal => {
  if (!childProcess.killed) childProcess.kill(signal);
};
['SIGINT', 'SIGTERM'].forEach(signal =>
  process.on(signal, () => forwardSignal(signal))
);

childProcess.on('exit', (code, signal) => {
  if (signal) {
    console.error(`"${command}" was killed by ${signal}.`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});

childProcess.on('error', error => {
  console.error(`Unable to run "${command}":`, error);
  process.exit(1);
});
