import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import os from "node:os";
import nodePath from "node:path";

import { describe, it, afterEach } from "mocha";

import { start } from "./tracee.ts";
import { create } from "./arch/index.ts";
import { registerAccessFor, waitpidSync, kill } from "./unix.ts";

import type { TWaitOptions } from "./unix.ts";
import type { TEnvironment } from "./tracee.ts";
import type { TArchitecture, TRegisters } from "./arch/index.ts";

const blocking: TWaitOptions = {
  block: true,
  reportUntracedStops: false,
  reportContinued: false
};

const PTRACE_GETREGS = 12;
const PTRACE_KILL_SIGNAL = 9;
const SYS_EXECVE = 59;
const ENOEXEC = 8;

const running = new Set<number>();

// tearing the tracee down has to happen whether or not the test passed,
// otherwise a failing assertion leaks a process
const forget = ({ pid }: { pid: number }): boolean => {
  try {
    kill({ pid, signal: PTRACE_KILL_SIGNAL });
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

const arch = create();
const registerAccess = registerAccessFor({ type: arch.Registers });

const startTracee = ({ path, args = [], env = {}, using = arch }: {
  path: string;
  args?: readonly string[];
  env?: TEnvironment;
  using?: TArchitecture;
}): number => {
  const pid = start({ path, args, env, arch: using, registerAccess });
  running.add(pid);

  return pid;
};

// the pids the kernel says are ours, so a test can tell whether a failed
// start left one behind
const ourChildren = (): readonly string[] => {
  const children = fs.readFileSync(`/proc/self/task/${process.pid}/children`, "utf8");

  return children.split(/\s+/).filter((entry) => {
    return entry.length > 0;
  });
};

const stoppedTracee = ({ path, args = [], env = {} }: {
  path: string;
  args?: readonly string[];
  env?: TEnvironment;
}): number => {
  const pid = startTracee({ path, args, env });
  waitpidSync({ pid, options: blocking });

  return pid;
};

const writeTempFile = ({ name, contents, mode }: { name: string; contents: string; mode: number }): string => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "unix-ptrace-"));
  const path = nodePath.join(dir, name);
  fs.writeFileSync(path, contents, { mode });

  return path;
};

describe("tracee", () => {

  describe("start", () => {

    it("stops the target at its own execve, before any of its code runs", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"] });

      const registers: TRegisters = {};
      registerAccess.read({ request: PTRACE_GETREGS, pid, registers });

      assert.equal(Number(registers.orig_rax), SYS_EXECVE);

    });

    it("leaves the tracee in a tracing stop", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"] });
      const state = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[0];

      assert.equal(state, "t");

    });

    it("hands the target the arguments it was given", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5", "--verbose"] });
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").slice(0, 3);

      assert.deepEqual(cmdline, ["/bin/sleep", "5", "--verbose"]);

    });

    it("hands the target the environment it was given", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"], env: { GREETING: "hello", LANG: "C" } });
      const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").slice(0, 2);

      assert.deepEqual(environ, ["GREETING=hello", "LANG=C"]);

    });

    it("gives the target an empty environment when it was given none", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"] });
      const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");

      assert.equal(environ, "");

    });

    it("does not leak our own environment to the target", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"], env: { LANG: "C" } });
      const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");

      assert.equal(environ.includes(`PATH=${process.env.PATH}`), false);

    });

    it("hands the target working stdio, which node would otherwise close on exec", () => {
      const pid = stoppedTracee({ path: "/bin/sleep", args: ["5"] });
      const open = [0, 1, 2].map((fd) => {
        return fs.existsSync(`/proc/${pid}/fd/${fd}`);
      });

      assert.deepEqual(open, [true, true, true]);

    });

    it("refuses a target that does not exist", () => {
      assert.throws(() => {
        startTracee({ path: "/does/not/exist" });
      }, /cannot execute '\/does\/not\/exist': ENOENT/);
    });

    it("refuses a target that is not executable", () => {
      const path = writeTempFile({ name: "plain.txt", contents: "not executable\n", mode: 0o644 });

      assert.throws(() => {
        startTracee({ path });
      }, /EACCES/);
    });

    it("exits the tracee with the errno when the exec itself fails", () => {
      const path = writeTempFile({ name: "bad-format", contents: "\x7fELF nonsense\n", mode: 0o755 });
      const status = waitpidSync({ pid: startTracee({ path }), options: blocking });

      assert.deepEqual(status, { type: "exited", code: ENOEXEC });
    });

    it("reports a tracee whose stdio it cannot share", () => {
      const noSuchSyscall = { ...arch, syscallNumbers: { ...arch.syscallNumbers, fcntl: 0xffff } };

      assert.throws(() => {
        startTracee({ path: "/bin/sleep", args: ["5"], using: noSuchSyscall });
      }, /failed to clear FD_CLOEXEC on descriptor 0/);
    });

    it("does not leave the tracee behind when the setup fails", () => {
      const noSuchSyscall = { ...arch, syscallNumbers: { ...arch.syscallNumbers, fcntl: 0xffff } };
      const before = ourChildren();

      assert.throws(() => {
        startTracee({ path: "/bin/sleep", args: ["5"], using: noSuchSyscall });
      });

      assert.deepEqual(ourChildren(), before);
    });

    it("releases the mappings the child inherited, rather than holding them open", () => {
      const before = fs.readFileSync("/proc/self/maps", "utf8").split("\n").length;
      stoppedTracee({ path: "/bin/sleep", args: ["5"] });
      const after = fs.readFileSync("/proc/self/maps", "utf8").split("\n").length;

      assert.equal(after <= before + 1, true, `mappings grew from ${before} to ${after}`);
    });
  });
});
