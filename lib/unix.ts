import koffi from "koffi";

import type { KoffiFunc, TypeObject } from "koffi";
import type { TRegisters } from "./arch/types.ts";

const lib = koffi.load(null);

// The build transpiler cannot parse a function type written inline inside a
// generic argument, so every native signature gets a named alias.
type TWaitpidCall = (pid: number, status: number[], options: number) => number;
type TPtraceCall = (req: number, pid: number, addr: bigint | null, data: bigint | null) => number;
type TKillCall = (pid: number, sig: number) => number;
type TDlsymCall = (handle: null, symbol: string) => unknown;
type TMunmapCall = (addr: bigint, length: number) => number;
type TMprotectCall = (addr: bigint, length: number, prot: number) => number;

type TMmapArgs = [addr: null, length: number, prot: number, flags: number, fd: number, offset: number];
type TMmapCall = (...args: TMmapArgs) => unknown;

type TCloneArgs = [
  fn: bigint,
  stack: bigint,
  flags: number,
  arg: number,
  ptid: number,
  tls: number,
  ctid: number
];
type TCloneCall = (...args: TCloneArgs) => number;

type TRegisterCall = (req: number, pid: number, addr: null, data: TRegisters) => number;

const waitpidRaw = lib.func("waitpid", "int", [
  "int",
  koffi.out(koffi.pointer("int")),
  "int"
]) as KoffiFunc<TWaitpidCall>;

const ptraceRaw = lib.func("long ptrace(int req, int pid, void *addr, void *data)") as KoffiFunc<TPtraceCall>;

const killRaw = lib.func("int kill(int pid, int sig)") as KoffiFunc<TKillCall>;

const dlsymRaw = lib.func("void *dlsym(void *handle, const char *symbol)") as KoffiFunc<TDlsymCall>;

const mmapRaw = lib.func("void *mmap(void *addr, size_t length, int prot, int flags, int fd, int64_t offset)") as
  KoffiFunc<TMmapCall>;

const munmapRaw = lib.func("int munmap(void *addr, size_t length)") as KoffiFunc<TMunmapCall>;

const mprotectRaw = lib.func("int mprotect(void *addr, size_t length, int prot)") as KoffiFunc<TMprotectCall>;

// glibc's clone() takes seven parameters and reads the last of them off the
// caller's stack. Declaring fewer leaves nothing there, so it reads past the
// top of koffi's call stack and segfaults whenever the page above happens to
// be unmapped.
const cloneRaw = lib.func("int clone(void *fn, void *stack, int flags, void *arg, void *ptid, void *tls, void *ctid)") as
  KoffiFunc<TCloneCall>;

const PROT_READ = 0x1;
const PROT_WRITE = 0x2;
const PROT_EXEC = 0x4;
const MAP_PRIVATE = 0x02;
const MAP_ANONYMOUS = 0x20;
const MAP_STACK = 0x20000;
const MAP_FAILED = -1n;
const PAGE_SIZE = 4096;

type TWaitStatus = {
  code: number;
  exited: () => boolean;
  signaled: () => boolean;
  stopped: () => boolean;
  continued: () => boolean;
  toString: () => string;
};

type TAllocation = {
  address: bigint;
  bytes: Uint8Array;
  free: () => void;
};

type TStackAllocation = {
  topAddress: bigint;
  free: () => void;
};

type TExecutableAllocation = {
  address: bigint;
  free: () => void;
};

type TRegisterAccess = {
  read: (params: { request: number; pid: number; registers: TRegisters }) => void;
  write: (params: { request: number; pid: number; registers: TRegisters }) => void;
};

// wait(2) status decoding, mirroring the WIFEXITED, WIFSIGNALED, WIFSTOPPED
// and WIFCONTINUED macros
const decodeStatus = (code: number): TWaitStatus => {
  const exited = () => {
    return (code & 0x7f) === 0;
  };

  const stopped = () => {
    return (code & 0xff) === 0x7f;
  };

  const continued = () => {
    return code === 0xffff;
  };

  const signaled = () => {
    return !exited() && !stopped() && !continued();
  };

  const predicates = { exited, signaled, stopped, continued };

  const toString = () => {
    const active = Object.entries(predicates).filter(([, test]) => {
      return test();
    }).map(([name]) => {
      return `[${name}]`;
    });

    return ["status", ...active].join(" ");
  };

  return {
    code,
    exited,
    signaled,
    stopped,
    continued,
    toString
  };
};

const waitFailure = ({ error, result }: { error: unknown; result: number }): Error | undefined => {
  if (error !== null && error !== undefined) {
    return Error("waitpid failed", { cause: error });
  }

  if (result < 0) {
    return Error(`waitpid failed: errno ${koffi.errno()}`);
  }

  return undefined;
};

// Setting a tracee up means waiting for stops the tracer itself provoked, so
// those waits are synchronous; only the caller-facing wait is deferred.
const waitpidSync = ({ pid, options }: { pid: number; options: number }): TWaitStatus => {
  const status = [0];
  const failure = waitFailure({ error: null, result: waitpidRaw(pid, status, options) });

  if (failure !== undefined) {
    throw failure;
  }

  return decodeStatus(status[0] ?? 0);
};

const waitpid = async ({ pid, options }: { pid: number; options: number }): Promise<TWaitStatus> => {
  const code = await new Promise<number>((resolve, reject) => {
    const status = [0];

    waitpidRaw.async(pid, status, options, (...outcome: [unknown, number]) => {
      const failure = waitFailure({ error: outcome[0], result: outcome[1] });

      if (failure !== undefined) {
        reject(failure);
        return;
      }

      resolve(status[0] ?? 0);
    });
  });

  return decodeStatus(code);
};

const ptrace = ({ request, pid, addr, data }: {
  request: number;
  pid: number;
  addr?: bigint | null;
  data?: bigint | null;
}): void => {
  const res = ptraceRaw(request, pid, addr ?? null, data ?? null);

  if (res < 0) {
    throw Error(`ptrace request ${request} failed: errno ${koffi.errno()}`);
  }
};

const kill = ({ pid, signal }: { pid: number; signal: number }): void => {
  const res = killRaw(pid, signal);

  if (res < 0) {
    throw Error(`kill failed: errno ${koffi.errno()}`);
  }
};

// ptrace requests that exchange a whole structure (PTRACE_GETREGS and
// friends) need the layout at declaration time, so they get their own
// bindings per structure type.
const registerAccessFor = ({ type }: { type: TypeObject }): TRegisterAccess => {
  const readRaw = lib.func("ptrace", "long", ["int", "int", "void *", koffi.out(koffi.pointer(type))]) as
    KoffiFunc<TRegisterCall>;

  const writeRaw = lib.func("ptrace", "long", ["int", "int", "void *", koffi.pointer(type)]) as
    KoffiFunc<TRegisterCall>;

  const check = ({ result }: { result: number }) => {
    if (result < 0) {
      throw Error(`ptrace register access failed: errno ${koffi.errno()}`);
    }
  };

  const read = ({ request, pid, registers }: { request: number; pid: number; registers: TRegisters }) => {
    check({ result: readRaw(request, pid, null, registers) });
  };

  const write = ({ request, pid, registers }: { request: number; pid: number; registers: TRegisters }) => {
    check({ result: writeRaw(request, pid, null, registers) });
  };

  return { read, write };
};

const mapAnonymous = ({ length, flags }: { length: number; flags: number }) => {
  const pointer = mmapRaw(null, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | flags, -1, 0);
  const address = koffi.address(pointer);

  if (address === MAP_FAILED) {
    throw Error(`mmap failed: errno ${koffi.errno()}`);
  }

  return {
    address,
    pointer,
    free: () => {
      munmapRaw(address, length);
    }
  };
};

// Anonymous memory that a cloned child inherits at the same address. The child
// gets a copy-on-write copy of the address space, so the parent may release
// its own mapping as soon as the clone exists.
const allocate = ({ length }: { length: number }): TAllocation => {
  const mapping = mapAnonymous({ length, flags: 0 });

  return {
    address: mapping.address,
    bytes: new Uint8Array(koffi.view(mapping.pointer, length)),
    free: mapping.free
  };
};

const allocateStack = ({ length }: { length: number }): TStackAllocation => {
  const mapping = mapAnonymous({ length, flags: MAP_STACK });

  return {
    topAddress: mapping.address + BigInt(length),
    free: mapping.free
  };
};

// A page holding a snippet of machine code, inherited by a cloned child at the
// same address. Never writable and executable at the same time.
const allocateExecutable = ({ code }: { code: Uint8Array }): TExecutableAllocation => {
  const mapping = allocate({ length: PAGE_SIZE });
  mapping.bytes.set(code, 0);

  if (mprotectRaw(mapping.address, PAGE_SIZE, PROT_READ | PROT_EXEC) < 0) {
    mapping.free();
    throw Error(`mprotect failed: errno ${koffi.errno()}`);
  }

  return {
    address: mapping.address,
    free: mapping.free
  };
};

const symbolAddress = ({ name }: { name: string }): bigint => {
  const pointer = dlsymRaw(null, name);

  if (pointer === null || pointer === undefined) {
    throw Error(`symbol '${name}' not found`);
  }

  return koffi.address(pointer);
};

// Starts a child that begins executing an existing native function instead of
// returning into the JavaScript runtime, which is what makes fork() fatal.
const cloneIntoFunction = ({ functionAddress, stackTopAddress, exitSignal }: {
  functionAddress: bigint;
  stackTopAddress: bigint;
  exitSignal: number;
}): number => {
  const pid = cloneRaw(functionAddress, stackTopAddress, exitSignal, 0, 0, 0, 0);

  if (pid < 0) {
    throw Error(`clone failed: errno ${koffi.errno()}`);
  }

  return pid;
};

export {
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
};

export type {
  TWaitStatus,
  TAllocation,
  TRegisterAccess
};
