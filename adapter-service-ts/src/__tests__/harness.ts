const GREEN = "\x1b[32m", RED = "\x1b[31m", RESET = "\x1b[0m", BOLD = "\x1b[1m", DIM = "\x1b[2m";

interface RegisteredTest {
  name: string;
  fn: () => void | Promise<void>;
}

interface Suite {
  name: string;
  tests: RegisteredTest[];
}

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

export function describe(name: string, fn: () => void): void {
  currentSuite = { name, tests: [] };
  suites.push(currentSuite);
  fn();
  currentSuite = null;
}

export function test(name: string, fn: () => void | Promise<void>): void {
  if (!currentSuite) {
    currentSuite = { name: "(root)", tests: [] };
    suites.push(currentSuite);
  }
  currentSuite.tests.push({ name, fn });
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(`${message || "assertEqual"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function assertRejects(fn: () => Promise<unknown>, message?: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message || "Expected promise to reject");
}

export function assertThrowsSync(fn: () => unknown, message?: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message || "Expected function to throw");
}

export function getSuiteCount(): number {
  return suites.length;
}

export async function runAll(): Promise<void> {
  let passed = 0, failed = 0;
  const failures: string[] = [];

  for (const suite of suites) {
    console.log(`\n${BOLD}${suite.name}${RESET}`);
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  ${GREEN}✓${RESET} ${t.name}`);
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`  ${RED}✗${RESET} ${t.name}\n    ${RED}${msg}${RESET}`);
        failures.push(`${suite.name} › ${t.name}: ${msg}`);
      }
    }
  }

  console.log(`\n${BOLD}─────────────────────────────${RESET}`);
  console.log(`${BOLD}Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
  console.log(`${BOLD}─────────────────────────────${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
}
