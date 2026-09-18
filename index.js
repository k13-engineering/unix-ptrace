import unix from "./lib/unix.js";
import memory from "./lib/memory.js";
import tracee from "./lib/tracee.js";

import structureFactory from "./lib/arch/index.js";

const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;

const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;

const PTRACE_DETACH = 17;

const PTRACE_SYSCALL = 24;

const spawn = async (path, args) => {
  const arch = structureFactory.create();
  const registerAccess = unix.ptraceStructAccessor(arch.Registers);

  const pid = await tracee.start({ path, args, arch, registerAccess });

  const mem = memory.accessor(pid);

  const wait = (opts) => unix.waitpid(-1, opts || 0);
  const cont = () => unix.ptrace(PTRACE_CONT, pid, null, null);
  const syscall = () => unix.ptrace(PTRACE_SYSCALL, pid, null, null);
  const singlestep = () => unix.ptrace(PTRACE_SINGLESTEP, pid, null, null);

  const regs = async (r) => {
    const data = {};
    registerAccess.read(PTRACE_GETREGS, pid, data);

    if (r) {
      for (const key in r) {
        if (typeof data[key] === "undefined") {
          throw Error(`unkown register '${key}'`);
        }
        data[key] = r[key];
      }

      registerAccess.write(PTRACE_SETREGS, pid, data);
    }

    return data;
  };

  const peek = async (offset, size) => await mem.peek(offset, size);
  const poke = async (offset, data) => await mem.poke(offset, data);

  const detach = async () => {
    await mem.close();
    unix.ptrace(PTRACE_DETACH, pid, null, null);
  };

  return {
    wait,
    cont,
    syscall,
    singlestep,
    regs,
    peek,
    poke,
    detach
  };
};

export default {
  spawn
};
