import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import nodePath from "node:path";

import { spawn } from "../lib/index.ts";

import type { TTracedProcess, TWaitStatus } from "../lib/index.ts";

const SYS_EXECVE = 59;

// Every tracee is driven to completion before the next test, because wait()
// reaps any child and a leftover one would be reported to the wrong test.
const runToExit = async ({ proc }: { proc: TTracedProcess }): Promise<TWaitStatus> => {
  const loop = async (): Promise<TWaitStatus> => {
    const status = await proc.wait();

    if (status.exited() || status.signaled()) {
      return status;
    }

    proc.cont();
    return await loop();
  };

  return await loop();
};

// A detached tracee keeps running and stays our child, so it has to be taken
// down here rather than left for the next test to trip over.
const stopTracee = async ({ proc }: { proc: TTracedProcess }): Promise<void> => {
  await proc.detach();
  process.kill(proc.pid, "SIGKILL");
  await proc.wait();
};

const writeTempFile = async ({ name, contents, mode }: {
  name: string;
  contents: string;
  mode: number;
}): Promise<string> => {
  const dir = await fs.promises.mkdtemp(nodePath.join(os.tmpdir(), "unix-ptrace-"));
  const path = nodePath.join(dir, name);
  await fs.promises.writeFile(path, contents, { mode });

  return path;
};

test("stops the tracee at its own execve", async () => {
  const proc = await spawn({ path: "/bin/sleep", args: ["5"] });
  const status = await proc.wait();
  const regs = await proc.regs();

  assert.equal(status.exited(), false);
  assert.equal(Number(regs.orig_rax), SYS_EXECVE);

  await stopTracee({ proc });
});

test("reads and writes registers", async () => {
  const proc = await spawn({ path: "/bin/sleep", args: ["5"] });
  await proc.wait();

  const before = await proc.regs();
  const after = await proc.setRegs({ registers: { r15: 0xdead } });

  assert.equal(Number(after.r15), 0xdead);
  assert.equal(Number(after.rip), Number(before.rip));

  await stopTracee({ proc });
});

test("rejects an unknown register name", async () => {
  const proc = await spawn({ path: "/bin/sleep", args: ["5"] });
  await proc.wait();

  await assert.rejects(() => {
    return proc.setRegs({ registers: { nonsense: 1 } });
  }, /unknown register/);

  await stopTracee({ proc });
});

test("reads and writes tracee memory", async () => {
  const proc = await spawn({ path: "/bin/sleep", args: ["5"] });
  await proc.wait();

  const regs = await proc.regs();
  const offset = Number(regs.rsp) - 256;
  await proc.poke({ offset, data: new TextEncoder().encode("ptrace") });

  assert.deepEqual(await proc.peek({ offset, size: 6 }), new TextEncoder().encode("ptrace"));

  await stopTracee({ proc });
});

test("reports every syscall until the tracee exits", async () => {
  const proc = await spawn({ path: "/bin/echo", args: ["traced"] });

  const loop = async ({ stops }: { stops: number }): Promise<{ status: TWaitStatus; stops: number }> => {
    const status = await proc.wait();

    if (status.exited() || status.signaled()) {
      return { status, stops };
    }

    proc.syscall();
    return await loop({ stops: stops + 1 });
  };

  const { status, stops } = await loop({ stops: 0 });

  assert.equal(status.exited(), true);
  assert.ok(stops > 20, `expected many syscall stops, got ${stops}`);
});

test("single steps the tracee", async () => {
  const proc = await spawn({ path: "/bin/true" });
  await proc.wait();

  for (const step of [1, 2, 3, 4, 5]) {
    proc.singlestep();
    const status = await proc.wait();
    assert.equal(status.stopped(), true, `step ${step} should leave the tracee stopped`);
  }

  proc.cont();
  assert.equal((await runToExit({ proc })).exited(), true);
});

test("rejects a target that does not exist", async () => {
  await assert.rejects(() => {
    return spawn({ path: "/does/not/exist" });
  }, /ENOENT/);
});

test("rejects a target that is not executable", async () => {
  const path = await writeTempFile({ name: "plain.txt", contents: "not executable\n", mode: 0o644 });

  await assert.rejects(() => {
    return spawn({ path });
  }, /EACCES/);
});

test("exits the tracee when the exec itself fails", async () => {
  const path = await writeTempFile({ name: "bad-format", contents: "\x7fELF garbage\n", mode: 0o755 });

  const proc = await spawn({ path });
  const status = await runToExit({ proc });

  assert.equal(status.exited(), true);
  assert.notEqual((status.code >> 8) & 0xff, 0);
});
