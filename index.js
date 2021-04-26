const Struct = require("ref-struct-napi");

const unix = require("./lib/unix");
const memory = require("./lib/memory");

const UserRegs = Struct({
  "r15": "int64",
  "r14": "int64",
  "r13": "int64",
  "r12": "int64",
  "rbp": "int64",
  "rbx": "int64",
  "r11": "int64",
  "r10": "int64",
  "r9": "int64",
  "r8": "int64",
  "rax": "int64",
  "rcx": "int64",
  "rdx": "int64",
  "rsi": "int64",
  "rdi": "int64",
  "orig_rax": "int64",
  "rip": "int64",
  "cs": "int64",
  "eflags": "int64",
  "rsp": "int64",
  "ss": "int64",
  "fs_base": "int64",
  "gs_base": "int64",
  "ds": "int64",
  "es": "int64",
  "fs": "int64",
  "gs": "int64",
});

const PTRACE_TRACEME = 0;
const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;

const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;

const PTRACE_DETACH = 11;

const PTRACE_SYSCALL = 24;

const forkAndExecve = (path, args) => {
  const pid = unix.fork();
  if (pid === 0) {
    try {
      const _dup2 = (stream, fd) => {
        const x = unix.dup(stream.fd);
        unix.dup2(x, fd);
        unix.close(x);
      };

      _dup2(process.stdin, 0);
      _dup2(process.stdout, 1);
      _dup2(process.stderr, 2);

      unix.ptrace(PTRACE_TRACEME, 0, null, null);
      unix.execve(path, [path].concat(args), null);
    } finally {
      // assure that we will always bail out in child process
      process.exit(-1);
    }
  }

  return pid;
};

const spawn = async (path, args) => {
  const pid = forkAndExecve(path, args);

  const mem = memory.accessor(pid);

  const wait = (opts) => unix.waitpid(-1, opts || 0);
  const cont = () => unix.ptrace(PTRACE_CONT, pid, null, null);
  const syscall = () => unix.ptrace(PTRACE_SYSCALL, pid, null, null);
  const singlestep = () => unix.ptrace(PTRACE_SINGLESTEP, pid, null, null);

  const regs = async (r) => {
    if (r) {
      const data = await regs();
      for (const key in r) {
        if (typeof data[key] === "undefined") {
          throw Error(`unkown register '${key}'`);
        }
        data[key] = r[key];
      }

      unix.ptrace(PTRACE_SETREGS, pid, null, data.ref());
      return data;
    } else {
      const res = UserRegs();
      unix.ptrace(PTRACE_GETREGS, pid, null, res.ref());
      return res;
    }
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

module.exports = {
  spawn
};
