import fs from "node:fs";

import {
  waitpidSync,
  ptrace,
  kill,
  allocate,
  allocateStack,
  allocateExecutable,
  symbolAddress,
  cloneIntoFunction
} from "./unix.ts";

import type { TRegisterAccess, TWaitOptions } from "./unix.ts";
import type { TArchitecture, TRegisters } from "./arch/index.ts";

// Every stop waited for here is one the tracer itself provoked, so there is
// nothing to gain from the wider reports.
const untilStopped: TWaitOptions = {
  block: true,
  reportUntracedStops: false,
  reportContinued: false
};

const PTRACE_CONT = 7;
const PTRACE_SINGLESTEP = 9;
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
const VECTOR_ALIGNMENT = 16;
const PAGE_SIZE = 4096;

type TArgumentBlock = {
  path: bigint;
  argv: bigint;
  envp: bigint;
  free: () => void;
};

// execve() takes the environment as a vector of KEY=value strings, but that
// is an encoding, not an interface: callers name the variables they want.
type TEnvironment = Readonly<Record<string, string>>;

type TStringLayout = {
  offsets: readonly number[];
  encoded: readonly Uint8Array[];
  size: number;
};

const alignTo = ({ value, boundary }: { value: number; boundary: number }): number => {
  return Math.ceil(value / boundary) * boundary;
};

const encodeCString = ({ value }: { value: string }): Uint8Array => {
  const encoded = new TextEncoder().encode(value);
  const withTerminator = new Uint8Array(encoded.length + 1);
  withTerminator.set(encoded, 0);

  return withTerminator;
};

const layOutStrings = ({ values }: { values: readonly string[] }): TStringLayout => {
  return values.reduce<TStringLayout>((layout, value) => {
    const encoded = encodeCString({ value });

    return {
      offsets: [...layout.offsets, layout.size],
      encoded: [...layout.encoded, encoded],
      size: layout.size + encoded.length
    };
  }, { offsets: [], encoded: [], size: 0 });
};

const writeVector = ({ view, offset, addresses }: {
  view: DataView;
  offset: number;
  addresses: readonly bigint[];
}): void => {
  addresses.forEach((address, index) => {
    view.setBigUint64(offset + index * POINTER_SIZE, address, true);
  });

  view.setBigUint64(offset + addresses.length * POINTER_SIZE, 0n, true);
};

// Lays out path, argv and envp exactly as execve() expects them. The block is
// written before the clone, so the child inherits it at identical addresses
// and nothing has to be poked into the tracee afterwards.
const buildArgumentBlock = ({ path, args, env }: {
  path: string;
  args: readonly string[];
  env: TEnvironment;
}): TArgumentBlock => {
  const argv = [path, ...args];
  const envp = Object.entries(env).map(([key, value]) => {
    return `${key}=${value}`;
  });

  const layout = layOutStrings({ values: [...argv, ...envp] });
  const argvOffset = alignTo({ value: layout.size, boundary: VECTOR_ALIGNMENT });
  const envpOffset = argvOffset + (argv.length + 1) * POINTER_SIZE;
  const length = alignTo({ value: envpOffset + (envp.length + 1) * POINTER_SIZE, boundary: PAGE_SIZE });

  const block = allocate({ length });
  const view = new DataView(block.bytes.buffer, block.bytes.byteOffset, block.bytes.byteLength);
  const addresses = layout.offsets.map((offset) => {
    return block.address + BigInt(offset);
  });

  layout.encoded.forEach((encoded, index) => {
    block.bytes.set(encoded, layout.offsets[index] ?? 0);
  });

  writeVector({ view, offset: argvOffset, addresses: addresses.slice(0, argv.length) });
  writeVector({ view, offset: envpOffset, addresses: addresses.slice(argv.length) });

  return {
    path: addresses[0] ?? 0n,
    argv: block.address + BigInt(argvOffset),
    envp: block.address + BigInt(envpOffset),
    free: block.free
  };
};

const registerFileFor = ({ pid, registerAccess }: { pid: number; registerAccess: TRegisterAccess }) => {
  const read = (): TRegisters => {
    return registerAccess.read({ pid });
  };

  const write = ({ registers }: { registers: TRegisters }): void => {
    registerAccess.write({ pid, registers });
  };

  return { read, write };
};

type TRegisterFile = ReturnType<typeof registerFileFor>;

const injectSyscall = ({ pid, arch, registers, address, number, args }: {
  pid: number;
  arch: TArchitecture;
  registers: TRegisterFile;
  address: bigint;
  number: number;
  args: readonly number[];
}): bigint => {
  registers.write({ registers: arch.prepareSyscall({ registers: registers.read(), address, number, args }) });
  ptrace({ request: PTRACE_SINGLESTEP, pid });
  waitpidSync({ pid, options: untilStopped });

  return arch.syscallResult({ registers: registers.read() });
};

// node marks its own stdio FD_CLOEXEC, which would leave the target without
// descriptors 0, 1 and 2 after the exec. Clearing it from inside the tracee
// keeps the side effect out of our own process.
const clearCloexec = ({ pid, arch, registers, address }: {
  pid: number;
  arch: TArchitecture;
  registers: TRegisterFile;
  address: bigint;
}): void => {
  for (const fd of STDIO_FDS) {
    const result = injectSyscall({
      pid,
      arch,
      registers,
      address,
      number: arch.syscallNumbers.fcntl,
      args: [fd, F_SETFD, 0]
    });

    if (result < 0n && result !== -BigInt(EBADF)) {
      throw Error(`failed to clear FD_CLOEXEC on descriptor ${fd}: errno ${-result}`);
    }
  }
};

const setUpTracee = ({ pid, arch, registerAccess, block, address }: {
  pid: number;
  arch: TArchitecture;
  registerAccess: TRegisterAccess;
  block: TArgumentBlock;
  address: bigint;
}): void => {
  ptrace({ request: PTRACE_SETOPTIONS, pid, data: BigInt(PTRACE_O_EXITKILL) });

  const registers = registerFileFor({ pid, registerAccess });
  clearCloexec({ pid, arch, registers, address });

  registers.write({
    registers: arch.prepareSyscall({
      registers: registers.read(),
      address,
      number: arch.syscallNumbers.execve,
      args: [block.path, block.argv, block.envp]
    })
  });

  ptrace({ request: PTRACE_SETOPTIONS, pid, data: 0n });
  ptrace({ request: PTRACE_CONT, pid });
};

const allocateInheritedMemory = ({ path, args, env, arch }: {
  path: string;
  args: readonly string[];
  env: TEnvironment;
  arch: TArchitecture;
}) => {
  return {
    block: buildArgumentBlock({ path, args, env }),
    stack: allocateStack({ length: CHILD_STACK_SIZE }),
    trampoline: allocateExecutable({ code: arch.syscallTrampoline })
  };
};

// An execve() that fails inside the tracee can only report itself as an exit
// code, so the common failures are worth catching up front.
const ensureExecutable = ({ path }: { path: string }): void => {
  try {
    fs.accessSync(path, fs.constants.X_OK);
  } catch (ex) {
    throw Error(`cannot execute '${path}': ${(ex as NodeJS.ErrnoException).code}`, { cause: ex });
  }
};

const discard = ({ pid }: { pid: number }): void => {
  kill({ pid, signal: SIGKILL });
  waitpidSync({ pid, options: untilStopped });
};

const attachAndRedirect = ({ arch, registerAccess, memory }: {
  arch: TArchitecture;
  registerAccess: TRegisterAccess;
  memory: ReturnType<typeof allocateInheritedMemory>;
}): number => {
  const pid = cloneIntoFunction({
    functionAddress: symbolAddress({ name: "pause" }),
    stackTopAddress: memory.stack.topAddress,
    exitSignal: SIGCHLD
  });

  try {
    ptrace({ request: PTRACE_ATTACH, pid });
    waitpidSync({ pid, options: untilStopped });
    setUpTracee({ pid, arch, registerAccess, block: memory.block, address: memory.trampoline.address });
  } catch (ex) {
    discard({ pid });
    throw ex;
  }

  return pid;
};

// Starts `path` stopped at its own execve, without forking the runtime and
// without a helper process: the child enters libc's pause() directly, and
// ptrace then redirects it into execve().
const start = ({ path, args, env, arch, registerAccess }: {
  path: string;
  args: readonly string[];
  env: TEnvironment;
  arch: TArchitecture;
  registerAccess: TRegisterAccess;
}): number => {
  ensureExecutable({ path });

  const memory = allocateInheritedMemory({ path, args, env, arch });

  try {
    return attachAndRedirect({ arch, registerAccess, memory });
  } finally {
    memory.block.free();
    memory.stack.free();
    memory.trampoline.free();
  }
};

export {
  start
};

export type {
  TArgumentBlock,
  TEnvironment
};
