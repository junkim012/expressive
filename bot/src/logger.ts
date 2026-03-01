import fs from 'fs';

const COLORS: Record<string, string> = {
  'Solver-A':   '\x1b[36m', // cyan
  'Solver-B':   '\x1b[35m', // magenta
  'Solver-C':   '\x1b[33m', // yellow
  'Lender-1':   '\x1b[34m', // blue
  'Lender-2':   '\x1b[34m', // blue
  'Borrower-1': '\x1b[33m', // yellow
  'Borrower-2': '\x1b[33m', // yellow
};

const LOG_FILES: Record<string, string> = {
  'Solver-A':   '/tmp/el-solver-a.log',
  'Solver-B':   '/tmp/el-solver-b.log',
  'Solver-C':   '/tmp/el-solver-c.log',
  'Lender-1':   '/tmp/el-lender-1.log',
  'Lender-2':   '/tmp/el-lender-2.log',
  'Borrower-1': '/tmp/el-borrower-1.log',
  'Borrower-2': '/tmp/el-borrower-2.log',
};

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

/** Truncate log files for the given labels. If no labels given, resets all. */
export function resetLogFiles(labels?: string[]): void {
  const files = labels
    ? labels.map((l) => LOG_FILES[l]).filter(Boolean)
    : Object.values(LOG_FILES);
  for (const file of files) {
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
