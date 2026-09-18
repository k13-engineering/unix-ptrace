import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { describe, it, afterEach } from "mocha";
import koffi from "koffi";

import {
  waitpid,
  waitpidSync,
  ptrace,
  kill,
  registerAccessFor,
  allocate,
  allocateStack,
  allocateExecutable,
  symbolAddress,
  cloneIntoFunction
} from "./unix.ts";

import { architecture } from "./arch/x86_64.ts";

import type { TWaitOptions } from "./unix.ts";
import type { TRegisters } from "./arch/index.ts";

const PTRACE_ATTACH = 16;
const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;

const SIGKILL = 9;
const SIGSTOP = 19;
const SIGCONT = 18;
const SIGCHLD = 17;

const blocking: TWaitOptions = {
  block: true,
  reportUntracedStops: false,
  reportContinued: false
};

const nonBlocking: TWaitOptions = {
  block: false,
  reportUntracedStops: false,
  reportContinued: false
};

const withUntracedStops: TWaitOptions = {
  block: true,
  reportUntracedStops: true,
  reportContinued: false
};

const withContinued: TWaitOptions = {
  block: true,
  reportUntracedStops: false,
  reportContinued: true
};

const PAGE_SIZE = 4096;
const NO_SUCH_PID = 0x7ffffff0;

const running = new Set<number>();

// tearing the child down has to happen whether or not the test passed,
// otherwise a failing assertion leaks a process
const forget = ({ pid }: { pid: number }): boolean => {
  try {
    kill({ pid, signal: SIGKILL });
    waitpidSync({ pid, options: blocking });
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  running.forEach((pid) => {
    forget({ pid });
  });
  running.clear();
});

type TMapping = {
  start: bigint;
  end: bigint;
  permissions: string;
};

const parseMapping = ({ line }: { line: string }): TMapping | undefined => {
  const fields = line.split(" ");
  const bounds = (fields[0] ?? "").split("-");

  if (bounds.length !== 2) {
    return undefined;
  }

  return {
    start: BigInt(`0x${bounds[0]}`),
    end: BigInt(`0x${bounds[1]}`),
    permissions: fields[1] ?? ""
  };
};

const mappingFor = ({ address }: { address: bigint }): TMapping | undefined => {
  return fs.readFileSync("/proc/self/maps", "utf8").split("\n").map((line) => {
    return parseMapping({ line });
  }).find((mapping) => {
    return mapping !== undefined && address >= mapping.start && address < mapping.end;
  });
};

const moduleUrl = import.meta.resolve("./unix.ts");

type TGuardedOutcome = {
  crashed: boolean;
  message: string;
};

// Some failures are expected to be reported as errors but currently take the
// whole process down, which would stop mocha reporting anything at all.
// Running them in a child keeps the rest of the suite readable.
const runGuarded = ({ body }: { body: string }): TGuardedOutcome => {
  const source = [
    `import * as unix from ${JSON.stringify(moduleUrl)};`,
    "try {",
    `  ${body}`,
    "  process.stdout.write(\"returned without an error\");",
    "} catch (ex) {",
    "  process.stdout.write(String(ex.message));",
    "}"
  ].join("\n");

  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" });

  return {
    crashed: child.signal !== null,
    message: child.stdout
  };
};

const startParkedChild = (): number => {
  const stack = allocateStack({ length: 64 * 1024 });
  const pid = cloneIntoFunction({
    functionAddress: symbolAddress({ name: "pause" }),
    stackTopAddress: stack.topAddress,
    exitSignal: SIGCHLD
  });
  running.add(pid);

  return pid;
};

const reap = ({ pid }: { pid: number }): void => {
  forget({ pid });
};

describe("unix", () => {

  describe("allocate", () => {

    it("hands back memory that really lives at the address it reports", () => {
      const allocation = allocate({ length: PAGE_SIZE });
      allocation.bytes.set([1, 2, 3, 4], 0);

      assert.deepEqual(new Uint8Array(koffi.view(allocation.address, 4)), new Uint8Array([1, 2, 3, 4]));

      allocation.free();
    });

    it("hands back exactly the requested length, readable and writable", () => {
      const allocation = allocate({ length: PAGE_SIZE });

      assert.equal(allocation.bytes.length, PAGE_SIZE);
      assert.equal(mappingFor({ address: allocation.address })?.permissions, "rw-p");

      allocation.free();
    });

    it("gives the memory back when freed", () => {
      const allocation = allocate({ length: PAGE_SIZE });
      const { address } = allocation;
      allocation.free();

      assert.equal(mappingFor({ address }), undefined);
    });

    it("reports a length the kernel cannot satisfy", () => {
      const outcome = runGuarded({ body: "unix.allocate({ length: Number.MAX_SAFE_INTEGER });" });

      assert.equal(outcome.crashed, false, "allocate killed the process instead of reporting the failure");
      assert.match(outcome.message, /mmap failed/);
    });
  });

  describe("allocateStack", () => {

    it("reports the top of the region, since stacks grow downwards", () => {
      const length = 64 * 1024;
      const stack = allocateStack({ length });

      assert.equal(mappingFor({ address: stack.topAddress - 1n })?.permissions, "rw-p");
      assert.equal(mappingFor({ address: stack.topAddress - BigInt(length) })?.permissions, "rw-p");

      stack.free();
    });

    it("gives the memory back when freed", () => {
      const stack = allocateStack({ length: PAGE_SIZE });
      const address = stack.topAddress - 1n;
      stack.free();

      assert.equal(mappingFor({ address }), undefined);
    });

    it("reports a length the kernel cannot satisfy", () => {
      const outcome = runGuarded({ body: "unix.allocateStack({ length: Number.MAX_SAFE_INTEGER });" });

      assert.equal(outcome.crashed, false, "allocateStack killed the process instead of reporting the failure");
      assert.match(outcome.message, /mmap failed/);
    });
  });

  describe("allocateExecutable", () => {

    it("places the code at the address it reports", () => {
      const page = allocateExecutable({ code: architecture.syscallTrampoline });
      const placed = new Uint8Array(koffi.view(page.address, architecture.syscallTrampoline.length));

      assert.deepEqual(placed, architecture.syscallTrampoline);

      page.free();
    });

    it("leaves the page executable but never writable", () => {
      const page = allocateExecutable({ code: architecture.syscallTrampoline });

      assert.equal(mappingFor({ address: page.address })?.permissions, "r-xp");

      page.free();
    });

    it("gives the memory back when freed", () => {
      const page = allocateExecutable({ code: architecture.syscallTrampoline });
      const { address } = page;
      page.free();

      assert.equal(mappingFor({ address }), undefined);
    });

    it("refuses code that does not fit in the page", () => {
      assert.throws(() => {
        allocateExecutable({ code: new Uint8Array(PAGE_SIZE + 1) });
      });
    });
  });

  describe("symbolAddress", () => {

    it("resolves a libc symbol to an executable address", () => {
      const address = symbolAddress({ name: "pause" });

      assert.equal(mappingFor({ address })?.permissions.includes("x"), true);
    });

    it("reports a symbol that does not exist", () => {
      assert.throws(() => {
        symbolAddress({ name: "there_is_no_such_symbol" });
      }, /symbol 'there_is_no_such_symbol' not found/);
    });
  });

  describe("cloneIntoFunction", () => {

    it("runs the function it is given in the child", () => {
      const stack = allocateStack({ length: 64 * 1024 });
      const pid = cloneIntoFunction({
        functionAddress: symbolAddress({ name: "_exit" }),
        stackTopAddress: stack.topAddress,
        exitSignal: SIGCHLD
      });

      const status = waitpidSync({ pid, options: blocking });

      assert.equal(status.type, "exited");
      stack.free();
    });

    it("leaves the child running while that function blocks", () => {
      const pid = startParkedChild();

      assert.equal(fs.existsSync(`/proc/${pid}`), true);

      reap({ pid });
    });

    it("returns the child's pid to the caller", () => {
      const pid = startParkedChild();

      assert.equal(pid > 0, true);
      assert.notEqual(pid, process.pid);

      reap({ pid });
    });

    it("reports a function address the kernel rejects", () => {
      const stack = allocateStack({ length: PAGE_SIZE });

      assert.throws(() => {
        cloneIntoFunction({ functionAddress: 0n, stackTopAddress: stack.topAddress, exitSignal: SIGCHLD });
      }, /clone failed/);

      stack.free();
    });
  });

  describe("kill", () => {

    it("delivers the signal to the child", () => {
      const pid = startParkedChild();
      kill({ pid, signal: SIGKILL });

      assert.deepEqual(waitpidSync({ pid, options: blocking }), { type: "signaled", signal: SIGKILL, dumpedCore: false });
    });

    it("reports a process that does not exist", () => {
      assert.throws(() => {
        kill({ pid: NO_SUCH_PID, signal: 0 });
      }, /kill failed/);
    });
  });

  describe("ptrace", () => {

    it("attaches to a child and stops it", () => {
      const pid = startParkedChild();
      ptrace({ request: PTRACE_ATTACH, pid });

      assert.deepEqual(waitpidSync({ pid, options: blocking }), { type: "stopped", signal: SIGSTOP });

      reap({ pid });
    });

    it("reports a request the kernel rejects", () => {
      assert.throws(() => {
        ptrace({ request: PTRACE_GETREGS, pid: NO_SUCH_PID });
      }, /ptrace request 12 failed/);
    });
  });

  describe("registerAccessFor", () => {

    const attachedChild = (): number => {
      const pid = startParkedChild();
      ptrace({ request: PTRACE_ATTACH, pid });
      waitpidSync({ pid, options: blocking });

      return pid;
    };

    it("reads the register set of a stopped tracee", () => {
      const access = registerAccessFor({ type: architecture.Registers });
      const pid = attachedChild();

      const registers: TRegisters = {};
      access.read({ request: PTRACE_GETREGS, pid, registers });

      assert.equal(Object.keys(registers).length, 27);
      assert.notEqual(Number(registers.rip), 0);

      reap({ pid });
    });

    it("writes a register set back to the tracee", () => {
      const access = registerAccessFor({ type: architecture.Registers });
      const pid = attachedChild();

      const registers: TRegisters = {};
      access.read({ request: PTRACE_GETREGS, pid, registers });
      access.write({ request: PTRACE_SETREGS, pid, registers: { ...registers, r15: 0xfeed } });

      const readBack: TRegisters = {};
      access.read({ request: PTRACE_GETREGS, pid, registers: readBack });

      assert.equal(Number(readBack.r15), 0xfeed);

      reap({ pid });
    });

    it("reports a read from a process that is not traced", () => {
      const access = registerAccessFor({ type: architecture.Registers });

      assert.throws(() => {
        access.read({ request: PTRACE_GETREGS, pid: NO_SUCH_PID, registers: {} });
      }, /ptrace register access failed/);
    });

    it("reports a write to a process that is not traced", () => {
      const access = registerAccessFor({ type: architecture.Registers });

      assert.throws(() => {
        access.write({ request: PTRACE_SETREGS, pid: NO_SUCH_PID, registers: {} });
      }, /ptrace register access failed/);
    });
  });

  describe("waitpidSync", () => {

    it("reports a child that exited of its own accord", () => {
      const stack = allocateStack({ length: 64 * 1024 });
      const pid = cloneIntoFunction({
        functionAddress: symbolAddress({ name: "_exit" }),
        stackTopAddress: stack.topAddress,
        exitSignal: SIGCHLD
      });

      const status = waitpidSync({ pid, options: blocking });

      assert.deepEqual(status, { type: "exited", code: 0 });
    });

    it("reports a child that was killed by a signal", () => {
      const pid = startParkedChild();
      kill({ pid, signal: SIGKILL });

      const status = waitpidSync({ pid, options: blocking });

      assert.deepEqual(status, { type: "signaled", signal: SIGKILL, dumpedCore: false });
    });

    it("reports a child that was stopped", () => {
      const pid = startParkedChild();
      kill({ pid, signal: SIGSTOP });

      assert.deepEqual(waitpidSync({ pid, options: withUntracedStops }), { type: "stopped", signal: SIGSTOP });

      kill({ pid, signal: SIGCONT });
      reap({ pid });
    });

    it("reports a child that was continued", () => {
      const pid = startParkedChild();
      kill({ pid, signal: SIGSTOP });
      waitpidSync({ pid, options: withUntracedStops });
      kill({ pid, signal: SIGCONT });

      assert.deepEqual(waitpidSync({ pid, options: withContinued }), { type: "continued" });

      reap({ pid });
    });

    it("reports that there is no such child", () => {
      assert.throws(() => {
        waitpidSync({ pid: NO_SUCH_PID, options: blocking });
      }, /waitpid failed/);
    });
  });

  describe("waitpid", () => {

    it("resolves once the child stops", async () => {
      const pid = startParkedChild();
      ptrace({ request: PTRACE_ATTACH, pid });

      assert.deepEqual(await waitpid({ pid, options: blocking }), { type: "stopped", signal: SIGSTOP });

      reap({ pid });
    });

    it("rejects when there is no such child", async () => {
      await assert.rejects(() => {
        return waitpid({ pid: NO_SUCH_PID, options: blocking });
      }, /waitpid failed/);
    });
  });

  describe("a wait that was told not to block", () => {

    it("reports that nothing happened, rather than a clean exit", () => {
      const pid = startParkedChild();
      const status = waitpidSync({ pid, options: nonBlocking });

      assert.deepEqual(status, { type: "unchanged" });

      reap({ pid });
    });

    it("still reports a change when there really was one", () => {
      const pid = startParkedChild();
      kill({ pid, signal: SIGKILL });
      const status = waitpidSync({ pid, options: blocking });

      assert.equal(status.type, "signaled");
    });
  });
});
