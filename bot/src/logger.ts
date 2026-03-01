import fs from 'fs';

const COLORS = {
  'Solver-A': '\x1b[36m', // cyan
  'Solver-B': '\x1b[35m', // magenta
  'Solver-C': '\x1b[33m', // yellow
} as Record<string, string>;

const LOG_FILES = {
  'Solver-A': '/tmp/el-solver-a.log',
  'Solver-B': '/tmp/el-solver-b.log',
  'Solver-C': '/tmp/el-solver-c.log',
} as Record<string, string>;

const NC = '\x1b[0m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function appendToFile(label: string, msg: string): void {
  const file = LOG_FILES[label];
  if (file) {
    fs.appendFileSync(file, `[${ts()}] [${label}] ${msg}\n`);
  }
}

/** Truncate all solver log files on startup. */
export function resetLogFiles(): void {
  for (const file of Object.values(LOG_FILES)) {
    fs.writeFileSync(file, '');
  }
}

export function log(label: string, msg: string): void {
  const color = COLORS[label] ?? '\x1b[37m';
  console.log(`${DIM}${ts()}${NC} ${color}[${label}]${NC} ${msg}`);
  appendToFile(label, msg);
}

export function warn(label: string, msg: string): void {
  const color = COLORS[label] ?? '\x1b[37m';
  console.log(`${DIM}${ts()}${NC} ${color}[${label}]${NC} ${RED}${msg}${NC}`);
  appendToFile(label, `WARN: ${msg}`);
}
