import { waitpid, ptrace, registerAccessFor } from "./unix.ts";
import { accessorFor } from "./memory.ts";
import { start } from "./tracee.ts";
import { create } from "./arch/index.ts";

import type { TWaitStatus } from "./unix.ts";
import type { TRegisters } from "./arch/types.ts";

const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;
const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;
const PTRACE_DETACH = 17;
const PTRACE_SYSCALL = 24;

// Every ptrace operation completes without blocking, so only waiting for the
// tracee to stop is asynchronous.
type TTracedProcess = {
  pid: number;
  wait: (params?: { options?: number }) => Promise<TWaitStatus>;
  cont: () => void;
  syscall: () => void;
  singlestep: () => void;
  regs: () => TRegisters;
  setRegs: (params: { registers: TRegisters }) => TRegisters;
  peek: (params: { offset: number; size: number }) => Uint8Array;
  poke: (params: { offset: number; data: Uint8Array }) => void;
  detach: () => void;
};

const mergeRegisters = ({ current, update }: {
  current: TRegisters;
  update: TRegisters;
}): TRegisters => {
  const unknown = Object.keys(update).filter((name) => {
    return current[name] === undefined;
  });

  if (unknown.length > 0) {
    throw Error(`unknown register${unknown.length > 1 ? "s" : ""} '${unknown.join("', '")}'`);
  }

  return { ...current, ...update };
};

const spawn = ({ path, args = [] }: {
  path: string;
  args?: readonly string[];
}): TTracedProcess => {
  const arch = create();
  const registerAccess = registerAccessFor({ type: arch.Registers });

  const pid = start({ path, args, arch, registerAccess });
  const memory = accessorFor({ pid });

  // Waiting on this tracee rather than on any child: every other child of the
  // host process, including ones it spawned itself, would otherwise have its
  // status consumed here.
  const wait = async ({ options = 0 }: { options?: number } = {}) => {
    return await waitpid({ pid, options });
  };

  const regs = (): TRegisters => {
    const registers: TRegisters = {};
    registerAccess.read({ request: PTRACE_GETREGS, pid, registers });

    return registers;
  };

  const setRegs = ({ registers }: { registers: TRegisters }): TRegisters => {
    const merged = mergeRegisters({ current: regs(), update: registers });
    registerAccess.write({ request: PTRACE_SETREGS, pid, registers: merged });

    return merged;
  };

  const detach = (): void => {
    memory.close();
    ptrace({ request: PTRACE_DETACH, pid });
  };

  return {
    pid,
    wait,
    cont: () => {
      ptrace({ request: PTRACE_CONT, pid });
    },
    syscall: () => {
      ptrace({ request: PTRACE_SYSCALL, pid });
    },
    singlestep: () => {
      ptrace({ request: PTRACE_SINGLESTEP, pid });
    },
    regs,
    setRegs,
    peek: memory.peek,
    poke: memory.poke,
    detach
  };
};

export {
  spawn
};

export type {
  TTracedProcess,
  TWaitStatus,
  TRegisters
};
