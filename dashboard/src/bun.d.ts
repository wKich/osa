// Minimal ambient declarations for the Bun runtime APIs this dashboard uses.
//
// The dashboard has zero npm dependencies on purpose, so `@types/bun` is not
// available. This file declares only the surface we call, mirroring Bun's
// documented signatures. Bun strips types at runtime and does not typecheck;
// these declarations exist so editors and optional `tsc` runs stay useful.
//
// Keep this file honest: when a Bun API call changes, update its declaration.

interface BunSubprocess {
  readonly pid: number;
  /** Resolves with the exit code once the child exits. */
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array> | undefined;
  readonly stderr: ReadableStream<Uint8Array> | undefined;
  kill(signal?: number | string): void;
}

interface BunSpawnOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: "pipe" | "ignore" | "inherit";
  stderr?: "pipe" | "ignore" | "inherit";
  stdin?: "pipe" | "ignore" | "inherit";
  onExit?: (
    proc: BunSubprocess,
    exitCode: number | null,
    signalCode: string | null,
    error?: Error,
  ) => void;
}

interface BunServer {
  readonly port: number;
  readonly hostname: string;
  stop(closeActiveConnections?: boolean): void;
}

interface BunServeOptions {
  port?: number;
  hostname?: string;
  development?: boolean;
  fetch(request: Request, server: BunServer): Response | Promise<Response>;
  error?(error: Error): Response | Promise<Response>;
}

interface BunGlobal {
  serve(options: BunServeOptions): BunServer;
  spawn(options: BunSpawnOptions): BunSubprocess;
  sleep(ms: number): Promise<void>;
  file(path: string): { text(): Promise<string>; readonly size: number };
  readonly TOML: { parse(input: string): unknown };
  which(command: string): string | null;
  hash(data: string | Uint8Array): number | bigint;
  readonly version: string;
}

declare const Bun: BunGlobal;

interface ProcessLike {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  cwd(): string;
}

declare const process: ProcessLike;

interface ImportMeta {
  readonly dir: string;
  readonly path: string;
  readonly url: string;
  readonly main: boolean;
}

declare module "node:fs" {
  export interface PathLike {
    toString(): string;
  }
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    readonly size: number;
    readonly mtimeMs: number;
  }
  export function statSync(path: string): Stats;
  export function lstatSync(path: string): Stats;
  export function realpathSync(path: string): string;
  export function openSync(path: string, flags: string): number;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function closeSync(fd: number): void;
  export function symlinkSync(target: string, path: string): void;
  export function chmodSync(path: string, mode: number): void;
  export function readFileSync(path: string): Uint8Array;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  export function describe(label: string, fn: TestFn): void;
  export function test(label: string, fn: TestFn): void;
  export function it(label: string, fn: TestFn): void;
  export function beforeAll(fn: TestFn): void;
  export function afterAll(fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;

  interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: string | RegExp): void;
    toMatchObject(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeInstanceOf(expected: unknown): void;
    toThrow(expected?: string | RegExp): void;
    readonly not: Matchers<T>;
    readonly resolves: Matchers<unknown>;
    readonly rejects: Matchers<unknown>;
  }

  export function expect<T = unknown>(actual: T): Matchers<T>;
}
