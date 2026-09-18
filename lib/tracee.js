import fs from "fs";

import unix from "./unix.js";

const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;
const PTRACE_GETREGS = 12;
const PTRACE_SETREGS = 13;
const PTRACE_ATTACH = 16;
const PTRACE_SETOPTIONS = 0x4200;
const PTRACE_O_EXITKILL = 0x00100000;

const SIGKILL = 9;
const SIGCHLD = 17;

const F_SETFD = 2;
const EBADF = 9;
const STDIO_FDS = [0, 1, 2];

const CHILD_STACK_SIZE = 256 * 1024;
const POINTER_SIZE = 8;

const align = (value, to) => Math.ceil(value / to) * to;

// Lays out path, argv and envp exactly as execve() expects them. The block is
// written before the clone, so the child inherits it at identical addresses
// and nothing has to be poked into the tracee afterwards.
const buildArgumentBlock = ({ path, args, env }) => {
  const argv = [path, ...args];
  const envp = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  const strings = [path, ...argv, ...envp].map((value) => Buffer.from(`${value}\0`, "utf8"));

  const stringBytes = strings.reduce((total, string) => total + string.length, 0);
  const vectorEntries = argv.length + 1 + envp.length + 1;
  const block = unix.allocate(align(align(stringBytes, 16) + vectorEntries * POINTER_SIZE, 4096));

  let offset = 0;
  const addresses = strings.map((string) => {
    const address = block.address + BigInt(offset);
    string.copy(block.bytes, offset);
    offset += string.length;
    return address;
  });
  offset = align(offset, 16);

  const writeVector = ({ from, count }) => {
    const address = block.address + BigInt(offset);
    for (let index = 0; index < count; index += 1) {
      block.bytes.writeBigUInt64LE(addresses[from + index], offset);
      offset += POINTER_SIZE;
    }
    block.bytes.writeBigUInt64LE(0n, offset);
    offset += POINTER_SIZE;
    return address;
  };

  return {
    "path": addresses[0],
    "argv": writeVector({ "from": 1, "count": argv.length }),
    "envp": writeVector({ "from": 1 + argv.length, "count": envp.length }),
    "free": block.free
  };
};

const registerFileFor = ({ pid, registerAccess }) => {
  const read = () => {
    const registers = {};
    registerAccess.read(PTRACE_GETREGS, pid, registers);
    return registers;
  };

  const write = (registers) => registerAccess.write(PTRACE_SETREGS, pid, registers);

  return { read, write };
};

const injectSyscall = async ({ pid, arch, registers, address, number, args }) => {
  registers.write(arch.prepareSyscall({ "registers": registers.read(), address, number, args }));
  unix.ptrace(PTRACE_SINGLESTEP, pid, null, null);
  await unix.waitpid(pid, 0);
  return arch.syscallResult({ "registers": registers.read() });
};

const setUpTracee = async ({ pid, arch, registerAccess, block, trampoline }) => {
  // a parked clone must not outlive us if we die before the execve
  unix.ptrace(PTRACE_SETOPTIONS, pid, null, PTRACE_O_EXITKILL);

  const registers = registerFileFor({ pid, registerAccess });
  const { address } = trampoline;

  // node marks its own stdio FD_CLOEXEC, which would leave the target without
  // descriptors 0, 1 and 2 after the exec. Clearing it from inside the tracee
  // keeps the side effect out of our own process.
  for (const fd of STDIO_FDS) {
    const result = await injectSyscall({
      pid, arch, registers, address,
      "number": arch.syscallNumbers.fcntl,
      "args": [fd, F_SETFD, 0]
    });

    // a descriptor the caller never opened needs no clearing
    if (result < 0n && result !== -BigInt(EBADF)) {
      throw new Error(`failed to clear FD_CLOEXEC on descriptor ${fd}: errno ${-result}`);
    }
  }

  registers.write(arch.prepareSyscall({
    "registers": registers.read(),
    address,
    "number": arch.syscallNumbers.execve,
    "args": [block.path, block.argv, block.envp]
  }));

  // normal tracee semantics from the execve onwards
  unix.ptrace(PTRACE_SETOPTIONS, pid, null, 0);
  unix.ptrace(PTRACE_CONT, pid, null, null);
};

const allocateInheritedMemory = ({ path, args, arch }) => {
  return {
    "block": buildArgumentBlock({ path, args, "env": process.env }),
    "stack": unix.allocateStack(CHILD_STACK_SIZE),
    // a `syscall` instruction at an address we choose, so redirecting the
    // tracee never depends on how far into pause() it happens to have got
    "trampoline": unix.allocateExecutable(arch.syscallTrampoline)
  };
};

// An execve() that fails inside the tracee can only report itself as an exit
// code, so the common failures are worth catching up front.
const ensureExecutable = async (path) => {
  try {
    await fs.promises.access(path, fs.constants.X_OK);
  } catch (ex) {
    throw new Error(`cannot execute '${path}': ${ex.code}`, { "cause": ex });
  }
};

const discard = async (pid) => {
  if (pid) {
    unix.kill(pid, SIGKILL);
    await unix.waitpid(pid, 0);
  }
};

// Starts `path` stopped at its own execve, without forking the runtime and
// without a helper process: the child enters libc's pause() directly, and
// ptrace then redirects it into execve().
const start = async ({ path, args, arch, registerAccess }) => {
  await ensureExecutable(path);

  const { block, stack, trampoline } = allocateInheritedMemory({ path, args, arch });

  let pid;
  try {
    pid = unix.cloneIntoFunction({
      "functionAddress": unix.symbolAddress("pause"),
      "stackTopAddress": stack.topAddress,
      "exitSignal": SIGCHLD
    });

    unix.ptrace(PTRACE_ATTACH, pid, null, null);
    await unix.waitpid(pid, 0);

    await setUpTracee({ pid, arch, registerAccess, block, trampoline });
  } catch (ex) {
    await discard(pid);
    throw ex;
  } finally {
    // the child holds its own copy-on-write copy of all three mappings
    block.free();
    stack.free();
    trampoline.free();
  }

  return pid;
};

export default {
  start
};
