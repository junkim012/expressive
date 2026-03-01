/**
 * Integration test suite for expressive-lending backend.
 *
 * Lifecycle (beforeAll, 120 s timeout):
 *   1. Kill anything lingering on ANVIL_PORT / BACKEND_PORT
 *   2. Spawn Anvil on ANVIL_PORT
 *   3. Run `forge script Deploy.s.sol` against it
 *   4. Mint collateral + repayment USDC to the borrower account
 *   5. Spawn the backend with a fresh SQLite DB
 *   6. Wait for /health, then let the catch-up sync settle
 *
 * Tests run sequentially (vitest default within one file) and share the
 * module-level state set up in beforeAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';

// ── Constants ─────────────────────────────────────────────────────────────────

const ANVIL_PORT = 18545;
const BACKEND_PORT = 13001;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const ANVIL_URL = `http://localhost:${ANVIL_PORT}`;

// Standard Anvil test accounts (deterministic)
const LENDER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const BORROWER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const LENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BORROWER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// Deterministic addresses on a fresh Anvil (deployer nonces 0-5)
const PROTOCOL = '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707';
const USDC = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const WBTC = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const WETH = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

const SECONDS_30_DAYS = 30 * 24 * 3600; // 2_592_000

const BACKEND_DIR = path.resolve(__dirname, '..');
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ERC20_ABI = parseAbi([
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
]);

const PROTOCOL_ABI = parseAbi([
  'function placeLendOrder(address borrowAsset, address[] calldata acceptableCollateral, uint256 minRate, uint256 maxLTV, uint256 maxDuration, uint256 maxLLTV, uint256 amount) external returns (uint256 orderId)',
  'function placeBorrowOrder(address borrowAsset, address[] calldata collateralAssets, uint256[] calldata collateralAmounts, uint256 maxRate, uint256 minLTV, uint256 minDuration, uint256 minLLTV, uint256 amount, bool fillOrKill) external returns (uint256 orderId)',
  'function submitBatch((uint256 lendOrderId, uint256 borrowOrderId, uint256 amount)[] pairs, (uint256 orderId, uint256 totalConsumed)[] consumptions) external',
  'function executeBatch() external',
  'function repay(uint256 loanId) external',
  'function markDefaulted(uint256 loanId) external',
]);

// ── Viem chain definition ─────────────────────────────────────────────────────

const anvilChain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_URL] } },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  check: () => Promise<T | null | undefined>,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result != null) return result;
    await sleep(300);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function api(p: string): Promise<any> {
  const res = await fetch(`${BACKEND_URL}${p}`);
  return res.json();
}

async function evm(method: string, params: unknown[] = []): Promise<any> {
  const res = await fetch(ANVIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as any;
  if (json.error) throw new Error(`EVM call ${method} failed: ${json.error.message}`);
  return json.result;
}

/** Advance EVM time by `seconds` then mine one block. */
async function mine(seconds = 0): Promise<void> {
  if (seconds > 0) await evm('evm_increaseTime', [seconds]);
  await evm('evm_mine', []);
}

/** Kill any process currently listening on `port` (macOS / Linux). */
function killPort(port: number): void {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      shell: '/bin/bash',
      stdio: 'ignore',
    });
  } catch {
    // port not in use — ignore
  }
}

// ── Shared state (set up in beforeAll) ───────────────────────────────────────

let anvilProc: ChildProcess;
let backendProc: ChildProcess;
let dbPath: string;

let publicClient: ReturnType<typeof createPublicClient>;
let lenderWallet: ReturnType<typeof createWalletClient>;
let borrowerWallet: ReturnType<typeof createWalletClient>;

async function sendTx(wallet: any, args: any): Promise<void> {
  const hash = await wallet.writeContract(args);
  await publicClient.waitForTransactionReceipt({ hash });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('integration', () => {
  // ── beforeAll ──────────────────────────────────────────────────────────────

  beforeAll(async () => {
    // 1. Kill any leftover processes from a previous run
    killPort(ANVIL_PORT);
    killPort(BACKEND_PORT);
    await sleep(400);

    // 2. Start Anvil
    anvilProc = spawn('anvil', ['--port', String(ANVIL_PORT)], { stdio: 'ignore' });
    await waitFor(async () => {
      try {
        await evm('eth_chainId');
        return true;
      } catch {
        return null;
      }
    }, 10_000);

    // 3. Deploy contracts (addresses are deterministic on fresh Anvil)
    execSync(
      [
        'forge script script/Deploy.s.sol:Deploy',
        `--rpc-url ${ANVIL_URL}`,
        '--broadcast',
        `--private-key ${LENDER_PK}`,
      ].join(' '),
      {
        cwd: CONTRACTS_DIR,
        env: { ...process.env, DEPLOYER_ADDRESS: LENDER },
        stdio: 'pipe',
        timeout: 60_000,
      },
    );

    // 4. Create viem clients
    publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(ANVIL_URL),
    });
    lenderWallet = createWalletClient({
      account: privateKeyToAccount(LENDER_PK),
      chain: anvilChain,
      transport: http(ANVIL_URL),
    });
    borrowerWallet = createWalletClient({
      account: privateKeyToAccount(BORROWER_PK),
      chain: anvilChain,
      transport: http(ANVIL_URL),
    });

    // 5. Mint collateral tokens to borrower + extra USDC for repayment interest
    await sendTx(lenderWallet, {
      address: WBTC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [BORROWER as `0x${string}`, 200_000_000n], // 2 WBTC (8 decimals)
    });
    await sendTx(lenderWallet, {
      address: WETH as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [BORROWER as `0x${string}`, 10n * 10n ** 18n], // 10 WETH
    });
    // Borrower will receive ~499.5 USDC as loan principal; mint a small buffer for interest
    await sendTx(lenderWallet, {
      address: USDC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [BORROWER as `0x${string}`, 5_000_000n], // 5 USDC
    });

    // 6. Start backend with a fresh DB
    dbPath = `/tmp/test-${Date.now()}.db`;
    backendProc = spawn('node_modules/.bin/tsx', ['src/index.ts'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        RPC_URL: ANVIL_URL,
        CONTRACT_ADDRESS: PROTOCOL,
        START_BLOCK: '1',
        SOLVER_FEE_RATE: '10',
        PORT: String(BACKEND_PORT),
        POLL_INTERVAL_MS: '200',
        DB_PATH: dbPath,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    // 7. Wait until /health responds
    await waitFor(async () => {
      try {
        const res = await api('/health');
        return res.ok === true ? res : null;
      } catch {
        return null;
      }
    }, 20_000);

    // 8. Let the indexer catch-up sync finish
    await sleep(1_500);
  }, 120_000);

  // ── afterAll ───────────────────────────────────────────────────────────────

  afterAll(async () => {
    backendProc?.kill('SIGKILL');
    anvilProc?.kill('SIGKILL');
    await sleep(300);
    killPort(BACKEND_PORT);
    killPort(ANVIL_PORT);
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  // ── Test 1: health and assets (read-only) ─────────────────────────────────

  it('1. health and assets', async () => {
    const health = await api('/health');
    expect(health).toEqual({ ok: true });

    const { borrowAssets, collateralAssets } = await api('/api/v1/assets');

    expect(borrowAssets.map((a: any) => a.symbol)).toContain('USDC');
    expect(collateralAssets.map((a: any) => a.symbol)).toContain('WBTC');
    expect(collateralAssets.map((a: any) => a.symbol)).toContain('WETH');

    const wbtcInfo = collateralAssets.find((a: any) => a.symbol === 'WBTC');
    expect(wbtcInfo?.decimals).toBe(8);
    const wethInfo = collateralAssets.find((a: any) => a.symbol === 'WETH');
    expect(wethInfo?.decimals).toBe(18);
  });

  // ── Test 2: empty state ────────────────────────────────────────────────────

  it('2. empty state', async () => {
    const { orders } = await api('/api/v1/orders');
    expect(orders).toHaveLength(0);

    const { loans } = await api('/api/v1/loans');
    expect(loans).toHaveLength(0);

    const { batches, total } = await api('/api/v1/batches');
    expect(batches).toHaveLength(0);
    expect(total).toBe(0);
  });

  // ── Test 3: lend order indexing ───────────────────────────────────────────

  it('3. lend order indexing', async () => {
    // Approve max USDC once — covers all lend orders in this test suite
    await sendTx(lenderWallet, {
      address: USDC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PROTOCOL as `0x${string}`, 2n ** 256n - 1n],
    });

    // Place lend order 0: 1000 USDC, accepts WBTC + WETH
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'placeLendOrder',
      args: [
        USDC as `0x${string}`,
        [WBTC as `0x${string}`, WETH as `0x${string}`],
        400n,                          // minRate (bps)
        7000n,                         // maxLTV (bps)
        BigInt(SECONDS_30_DAYS * 3),   // maxDuration = 90 days
        8000n,                         // maxLLTV (bps)
        1_000_000_000n,                // amount: 1000 USDC (6 decimals)
      ],
    });

    // Wait for the indexer to pick it up
    const order = await waitFor(async () => {
      const { orders } = await api('/api/v1/orders');
      return orders.length > 0 ? orders[0] : null;
    }, 8_000);

    expect(order.orderId).toBe('0');
    expect(order.orderType).toBe('lend');
    expect(order.minRate).toBe(400);
    expect(order.maxLtv).toBe(7000);
    expect(order.maxDuration).toBe(SECONDS_30_DAYS * 3);
    expect(order.maxLltv).toBe(8000);
    expect(order.amount).toBe('1000000000');
    expect(order.filledAmount).toBe('0');
    expect(order.status).toBe('open');
    expect(order.borrowAsset.toLowerCase()).toBe(USDC.toLowerCase());

    const collateral: string[] = order.acceptableCollateral.map((a: string) => a.toLowerCase());
    expect(collateral).toContain(WBTC.toLowerCase());
    expect(collateral).toContain(WETH.toLowerCase());
  });

  // ── Test 4: borrow order indexing ────────────────────────────────────────

  it('4. borrow order indexing', async () => {
    // Approve max WBTC and USDC (for repayment) for the protocol
    await sendTx(borrowerWallet, {
      address: WBTC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PROTOCOL as `0x${string}`, 2n ** 256n - 1n],
    });
    await sendTx(borrowerWallet, {
      address: USDC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PROTOCOL as `0x${string}`, 2n ** 256n - 1n],
    });

    // Place borrow order 1: 500 USDC desired, 1 WBTC collateral
    await sendTx(borrowerWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'placeBorrowOrder',
      args: [
        USDC as `0x${string}`,
        [WBTC as `0x${string}`],
        [100_000_000n],               // 1 WBTC (8 decimals)
        600n,                         // maxRate (bps)
        5000n,                        // minLTV (bps)
        BigInt(SECONDS_30_DAYS),      // minDuration = 30 days
        7000n,                        // minLLTV (bps)
        500_000_000n,                 // amount: 500 USDC (6 decimals)
        false,                        // fillOrKill
      ],
    });

    const { orders } = await waitFor(async () => {
      const data = await api('/api/v1/orders');
      return data.orders.length >= 2 ? data : null;
    }, 8_000);

    const borrow = orders.find((o: any) => o.orderId === '1');
    expect(borrow).toBeDefined();
    expect(borrow.orderType).toBe('borrow');
    expect(borrow.maxRate).toBe(600);
    expect(borrow.minLtv).toBe(5000);
    expect(borrow.minDuration).toBe(SECONDS_30_DAYS);
    expect(borrow.minLltv).toBe(7000);
    expect(borrow.amount).toBe('500000000');
    expect(borrow.filledAmount).toBe('0');
    expect(borrow.status).toBe('open');
    expect(borrow.owner.toLowerCase()).toBe(BORROWER.toLowerCase());

    const assets: string[] = borrow.collateralAssets.map((a: string) => a.toLowerCase());
    expect(assets).toContain(WBTC.toLowerCase());
    expect(borrow.collateralAmounts).toContain('100000000');
  });

  // ── Test 5: filter by type / owner ───────────────────────────────────────

  it('5. filter by type and owner', async () => {
    const { orders: lendOrders } = await api('/api/v1/orders?type=lend');
    expect(lendOrders).toHaveLength(1);
    expect(lendOrders[0].orderType).toBe('lend');

    const { orders: borrowOrders } = await api('/api/v1/orders?type=borrow');
    expect(borrowOrders).toHaveLength(1);
    expect(borrowOrders[0].orderType).toBe('borrow');

    const { orders: lenderOrders } = await api(`/api/v1/orders?owner=${LENDER}`);
    expect(lenderOrders).toHaveLength(1);
    expect(lenderOrders[0].orderId).toBe('0');
  });

  // ── Test 6: batch execution → loan creation ───────────────────────────────

  it('6. batch execution → loan creation', async () => {
    // Submit batch: match lend order 0 ↔ borrow order 1, amount = 500 USDC
    // Consumptions sorted ascending by orderId
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'submitBatch',
      args: [
        [{ lendOrderId: 0n, borrowOrderId: 1n, amount: 500_000_000n }],
        [
          { orderId: 0n, totalConsumed: 500_000_000n },
          { orderId: 1n, totalConsumed: 500_000_000n },
        ],
      ],
    });

    // Advance past the 30-second batch window
    await mine(35);

    // Execute — emits BatchExecuted(0, lender, surplus, 1) + LoanCreated(0, ...)
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'executeBatch',
      args: [],
    });

    // Wait for the indexer to record loan 0
    const { loans } = await waitFor(async () => {
      const data = await api('/api/v1/loans');
      return data.loans.length > 0 ? data : null;
    }, 10_000);

    expect(loans).toHaveLength(1);
    const loan = loans[0];
    expect(loan.loanId).toBe('0');
    expect(loan.lendOrderId).toBe('0');
    expect(loan.borrowOrderId).toBe('1');
    expect(loan.lender.toLowerCase()).toBe(LENDER.toLowerCase());
    expect(loan.borrower.toLowerCase()).toBe(BORROWER.toLowerCase());
    // principal = 500e6 - (500e6 * 10 / 10_000) = 500_000_000 - 500_000 = 499_500_000
    expect(loan.principal).toBe('499500000');
    // rate = midpoint of minRate=400 and maxRate=600 = 500
    expect(loan.rate).toBe(500);
    expect(loan.status).toBe('active');
    expect(loan.borrowAsset.toLowerCase()).toBe(USDC.toLowerCase());
    // originationDate should be a recent Unix timestamp (> 2020)
    expect(loan.originationDate).toBeGreaterThan(1_577_836_800);

    // Lend order 0: 500/1000 filled → still open
    const { orders } = await api('/api/v1/orders');
    const lendOrder = orders.find((o: any) => o.orderId === '0');
    expect(lendOrder.filledAmount).toBe('500000000');
    expect(lendOrder.status).toBe('open');

    // Borrow order 1: 500/500 filled → fully filled
    const borrowOrder = orders.find((o: any) => o.orderId === '1');
    expect(borrowOrder.filledAmount).toBe('500000000');
    expect(borrowOrder.status).toBe('filled');

    // Batches: at least one entry, and the executed batch has 1 pair
    const { batches, total } = await api('/api/v1/batches');
    expect(total).toBeGreaterThanOrEqual(1);
    const execBatch = batches.find((b: any) => b.pairCount > 0);
    expect(execBatch).toBeDefined();
    expect(execBatch.solver.toLowerCase()).toBe(LENDER.toLowerCase());
    expect(execBatch.pairCount).toBe(1);

    // Loan detail endpoint
    const detail = await api('/api/v1/loans/0');
    expect(detail.loan.loanId).toBe('0');
    expect(detail.events).toHaveLength(0);
  });

  // ── Test 7: loan repayment ────────────────────────────────────────────────

  it('7. loan repayment', async () => {
    // Borrower received ~499.5 USDC principal + was minted 5 USDC extra → enough to repay
    await sendTx(borrowerWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'repay',
      args: [0n],
    });

    const detail = await waitFor(async () => {
      const data = await api('/api/v1/loans/0');
      return data.loan.status === 'repaid' ? data : null;
    }, 10_000);

    expect(detail.loan.status).toBe('repaid');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].eventType).toBe('repaid');
  });

  // ── Test 8: second loan cycle → default ──────────────────────────────────

  it('8. loan default (second loan cycle)', async () => {
    // Place lend order 2: another 1000 USDC (lend order 0 is 50% filled, still open,
    // but we open a fresh order so test 9 can observe a partially-filled open order)
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'placeLendOrder',
      args: [
        USDC as `0x${string}`,
        [WBTC as `0x${string}`, WETH as `0x${string}`],
        400n,
        7000n,
        BigInt(SECONDS_30_DAYS * 3),
        8000n,
        1_000_000_000n,
      ],
    });

    // Place borrow order 3: 500 USDC, 1 WBTC collateral
    // Borrower has 2 WBTC (minted in beforeAll); 1st was returned after repayment of loan 0
    await sendTx(borrowerWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'placeBorrowOrder',
      args: [
        USDC as `0x${string}`,
        [WBTC as `0x${string}`],
        [100_000_000n],
        600n,
        5000n,
        BigInt(SECONDS_30_DAYS),
        7000n,
        500_000_000n,
        false,
      ],
    });

    // Wait for both new orders to be indexed (total orders: 0, 1, 2, 3)
    await waitFor(async () => {
      const { orders } = await api('/api/v1/orders');
      return orders.length >= 4 ? orders : null;
    }, 8_000);

    // Submit batch: lend order 2 ↔ borrow order 3
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'submitBatch',
      args: [
        [{ lendOrderId: 2n, borrowOrderId: 3n, amount: 500_000_000n }],
        [
          { orderId: 2n, totalConsumed: 500_000_000n },
          { orderId: 3n, totalConsumed: 500_000_000n },
        ],
      ],
    });

    await mine(35);

    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'executeBatch',
      args: [],
    });

    // Wait for loan 1 to appear
    await waitFor(async () => {
      const { loans } = await api('/api/v1/loans');
      return loans.length >= 2 ? loans : null;
    }, 10_000);

    // Advance past the 30-day loan duration
    await mine(SECONDS_30_DAYS + 1);

    // Permissionlessly mark loan 1 as defaulted
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'markDefaulted',
      args: [1n],
    });

    const detail = await waitFor(async () => {
      const data = await api('/api/v1/loans/1');
      return data.loan.status === 'defaulted' ? data : null;
    }, 10_000);

    expect(detail.loan.status).toBe('defaulted');
    expect(detail.loan.loanId).toBe('1');
    expect(detail.loan.lendOrderId).toBe('2');
    expect(detail.loan.borrowOrderId).toBe('3');
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].eventType).toBe('defaulted');
  });

  // ── Test 9: WebSocket snapshot ────────────────────────────────────────────

  it('9. websocket snapshot', async () => {
    const ws = new WebSocket(`ws://localhost:${BACKEND_PORT}/ws/orderbook`);

    const msg = await new Promise<any>((resolve, reject) => {
      ws.once('message', (data) => {
        try {
          resolve(JSON.parse(data.toString()));
        } catch (e) {
          reject(e);
        }
      });
      ws.once('error', reject);
      setTimeout(() => reject(new Error('WS snapshot timeout')), 8_000);
    });

    ws.close();

    expect(msg.type).toBe('snapshot');
    expect(msg.data).toHaveProperty('lendOrders');
    expect(msg.data).toHaveProperty('borrowOrders');

    // At least lend orders 0 (50% filled) and 2 (50% filled) should be 'open'
    expect(msg.data.lendOrders.length).toBeGreaterThanOrEqual(1);

    // Lend order 2 must appear in the snapshot
    const order2 = msg.data.lendOrders.find((o: any) => o.orderId === '2');
    expect(order2).toBeDefined();

    // Both borrow orders are fully filled → borrowOrders may be empty
    for (const o of msg.data.borrowOrders) {
      expect(o.status).toBe('open');
    }
  });

  // ── Test 10: WebSocket update on new order ────────────────────────────────

  it('10. websocket update on new order', async () => {
    const ws = new WebSocket(`ws://localhost:${BACKEND_PORT}/ws/orderbook`);
    const received: any[] = [];

    // Register message listener before anything else to capture all messages
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    // Wait for the connection to open
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    // Small delay so the snapshot has time to arrive
    await sleep(300);

    // Set up the update promise BEFORE placing the order
    const updatePromise = new Promise<any>((resolve, reject) => {
      const check = (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'update') {
          ws.off('message', check);
          resolve(msg);
        }
      };
      ws.on('message', check);
      setTimeout(() => reject(new Error('WS update timeout after 15 s')), 15_000);
    });

    // Place a new lend order → triggers broadcastUpdate from the indexer
    await sendTx(lenderWallet, {
      address: PROTOCOL as `0x${string}`,
      abi: PROTOCOL_ABI,
      functionName: 'placeLendOrder',
      args: [
        USDC as `0x${string}`,
        [WBTC as `0x${string}`, WETH as `0x${string}`],
        300n,
        6000n,
        BigInt(SECONDS_30_DAYS * 6),
        8500n,
        500_000_000n,
      ],
    });

    const update = await updatePromise;
    ws.close();

    // First message must be the snapshot
    expect(received[0]?.type).toBe('snapshot');

    // The update message carries the newly placed order
    expect(update.type).toBe('update');
    expect(update.data.newOrders).toHaveLength(1);
    expect(update.data.newOrders[0].orderType).toBe('lend');
    expect(update.data.newOrders[0].minRate).toBe(300);
  });
});
