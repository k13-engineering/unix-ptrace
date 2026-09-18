import assert from "node:assert/strict";
import fs from "node:fs";

import { describe, it, afterEach } from "mocha";

import { spawn } from "./index.ts";
import { waitpidSync, kill } from "./unix.ts";

import type { TTracedProcess, TWaitStatus } from "./index.ts";

const SYS_EXECVE = 59;
const SIGKILL = 9;
const WNOHANG = 1;
const encoder = new TextEncoder();

const running = new Set<TTracedProcess>();

// tearing the tracee down has to happen whether or not the test passed,
// otherwise a failing assertion leaks a process
const forget = ({ pid }: { pid: number }): boolean => {
  try {
    kill({ pid, signal: SIGKILL });
    waitpidSync({ pid, options: 0 });
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  running.forEach((proc) => {
    forget({ pid: proc.pid });
  });
  running.clear();
});

const stopped = ({ path, args = [] }: { path: string; args?: readonly string[] }): Promise<TTracedProcess> => {
  const proc = spawn({ path, args });
  running.add(proc);

  return proc.wait().then(() => {
    return proc;
  });
};

const runToExit = async ({ proc }: { proc: TTracedProcess }): Promise<TWaitStatus> => {
  const loop = async (): Promise<TWaitStatus> => {
    const status = await proc.wait();

    if (status.type === "exited" || status.type === "signaled") {
      return status;
    }

    proc.cont();
    return await loop();
  };

  return await loop();
};

const tracerOf = ({ pid }: { pid: number }): string => {
  const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");

  return status.split("\n").find((line) => {
    return line.startsWith("TracerPid:");
  }) ?? "";
};

describe("spawn", () => {

  it("reports the pid of the process it started", async () => {
    const proc = await stopped({ path: "/bin/sleep", args: ["5"] });

    assert.equal(proc.pid > 0, true);
    assert.equal(fs.existsSync(`/proc/${proc.pid}`), true);

  });

  it("runs the target with no arguments when none are given", async () => {
    const proc = await stopped({ path: "/bin/true" });

    assert.deepEqual(fs.readFileSync(`/proc/${proc.pid}/cmdline`, "utf8").split("\0").slice(0, 1), ["/bin/true"]);

    proc.cont();
    await runToExit({ proc });
  });

  describe("wait", () => {

    it("reports the execve stop first, before the target has run", async () => {
      const proc = spawn({ path: "/bin/sleep", args: ["5"] });
      running.add(proc);
      const status = await proc.wait();

      assert.equal(status.type, "stopped");
      assert.equal(Number(proc.regs().orig_rax), SYS_EXECVE);

    });

    it("does not claim the tracee exited when told not to block", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      proc.cont();

      assert.deepEqual(await proc.wait({ options: WNOHANG }), { type: "unchanged" });

    });

    it("reports only this tracee, not some other child of ours", async () => {
      const earlier = await stopped({ path: "/bin/sleep", args: ["0.1"] });
      earlier.detach();
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });

      const proc = spawn({ path: "/bin/sleep", args: ["5"] });
      running.add(proc);

      assert.equal((await proc.wait()).type, "stopped");

      forget({ pid: earlier.pid });
    });
  });

  describe("regs", () => {

    it("reads the register set of the stopped tracee", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      const registers = proc.regs();

      assert.equal(Object.keys(registers).length, 27);
      assert.notEqual(Number(registers.rip), 0);

    });
  });

  describe("setRegs", () => {

    it("writes the registers through to the tracee", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      proc.setRegs({ registers: { r15: 0xdead } });

      assert.equal(Number(proc.regs().r15), 0xdead);

    });

    it("leaves the registers it was not given alone", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      const before = proc.regs();
      const after = proc.setRegs({ registers: { r15: 0xdead } });

      assert.equal(Number(after.rip), Number(before.rip));

    });

    it("refuses a register the architecture does not have", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });

      assert.throws(() => {
        proc.setRegs({ registers: { nonsense: 1 } });
      }, /unknown register 'nonsense'/);

    });

    it("names every register it does not know", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });

      assert.throws(() => {
        proc.setRegs({ registers: { nonsense: 1, alsoWrong: 2 } });
      }, /unknown registers 'nonsense', 'alsoWrong'/);

    });
  });

  describe("peek and poke", () => {

    it("reads the memory of the tracee", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      const instructions = proc.peek({ offset: Number(proc.regs().rip), size: 4 });

      assert.equal(instructions.length, 4);

    });

    it("writes the memory of the tracee", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      const offset = Number(proc.regs().rsp) - 256;
      proc.poke({ offset, data: encoder.encode("ptrace") });

      assert.deepEqual(proc.peek({ offset, size: 6 }), encoder.encode("ptrace"));

    });
  });

  describe("cont", () => {

    it("lets the tracee run to completion", async () => {
      const proc = await stopped({ path: "/bin/true" });
      proc.cont();

      assert.deepEqual(await runToExit({ proc }), { type: "exited", code: 0 });
    });
  });

  describe("syscall", () => {

    it("stops on every syscall the tracee makes", async () => {
      const proc = await stopped({ path: "/bin/true" });

      const loop = async ({ stops }: { stops: number }): Promise<number> => {
        const status = await proc.wait();

        if (status.type === "exited" || status.type === "signaled") {
          return stops;
        }

        proc.syscall();
        return await loop({ stops: stops + 1 });
      };

      proc.syscall();

      assert.equal(await loop({ stops: 0 }) > 20, true);
    });
  });

  describe("singlestep", () => {

    it("advances the tracee by one instruction", async () => {
      const proc = await stopped({ path: "/bin/true" });
      const before = Number(proc.regs().rip);

      proc.singlestep();
      await proc.wait();

      assert.notEqual(Number(proc.regs().rip), before);

    });
  });

  describe("detach", () => {

    it("stops tracing and lets the tracee carry on", async () => {
      const proc = await stopped({ path: "/bin/sleep", args: ["5"] });
      proc.detach();

      assert.equal(tracerOf({ pid: proc.pid }), "TracerPid:\t0");

    });
  });
});
