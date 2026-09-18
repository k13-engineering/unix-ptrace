import koffi from "koffi";

const lib = koffi.load(null);

const waitpidRaw = lib.func("waitpid", "int", ["int", koffi.out(koffi.pointer("int")), "int"]);
const ptraceRaw = lib.func("ptrace", "long", ["int", "int", "void *", "void *"]);
const killRaw = lib.func("kill", "int", ["int", "int"]);
const execvRaw = lib.func("execv", "int", ["str", koffi.pointer("str")]);
const fcntlRaw = lib.func("int fcntl(int fd, int cmd, ...)");
const dupRaw = lib.func("dup", "int", ["int"]);
const dup2Raw = lib.func("dup2", "int", ["int", "int"]);
const closeRaw = lib.func("close", "int", ["int"]);

const dlsymRaw = lib.func("void *dlsym(void *handle, const char *symbol)");
const mmapRaw = lib.func("void *mmap(void *addr, size_t length, int prot, int flags, int fd, int64_t offset)");
const munmapRaw = lib.func("int munmap(void *addr, size_t length)");
const mprotectRaw = lib.func("int mprotect(void *addr, size_t length, int prot)");

// glibc's clone() takes seven parameters and reads the last of them off the
// caller's stack. Declaring fewer leaves nothing there, so it reads past the
// top of koffi's call stack and segfaults whenever the page above happens to
// be unmapped.
const cloneRaw = lib.func("int clone(void *fn, void *stack, int flags, void *arg, void *ptid, void *tls, void *ctid)");

const PROT_READ = 0x1;
const PROT_WRITE = 0x2;
const MAP_PRIVATE = 0x02;
const MAP_ANONYMOUS = 0x20;
const MAP_STACK = 0x20000;
const PROT_EXEC = 0x4;
const MAP_FAILED = -1n;

const _status = (status) => {
  const code = status;

  // wait(2) status decoding, mirroring the WIFEXITED/WIFSIGNALED/WIFSTOPPED
  // and WIFCONTINUED macros
  const exited = () => {
    return (status & 0x7f) === 0;
  };

  const stopped = () => {
    return (status & 0xff) === 0x7f;
  };

  const continued = () => {
    return status === 0xffff;
  };

  const signaled = () => {
    return !exited() && !stopped() && !continued();
  };

  const toString = () => {
    let str = "status";
    str += exited() ? " [exited]" : "";
    str += signaled() ? " [signaled]" : "";
    str += stopped() ? " [stopped]" : "";
    str += continued() ? " [continued]" : "";
    return str;
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

const waitpid = async (pid, options) => {
  const status = await new Promise((resolve, reject) => {
    const sptr = [0];
    waitpidRaw.async(pid, sptr, options, (err, res) => {
      if (err) {
        reject(err);
      } else if (res < 0) {
        reject(new Error(`waitpid failed: ${koffi.errno()}`));
      } else {
        resolve(sptr[0]);
      }
    });
  });

  return _status(status);
};

const dup = (fd) => {
  const res = dupRaw(fd);
  if (res < 0) {
    throw new Error(`failed to dup: ${koffi.errno()}`);
  }
  return res;
};

const close = (fd) => closeRaw(fd);

const dup2 = (ofd, nfd) => {
  const res = dup2Raw(ofd, nfd);
  if (res < 0) {
    throw new Error(`failed to dup: ${koffi.errno()}`);
  }
  return res;
};

const fcntl = (fd, cmd, val) => fcntlRaw(fd, cmd, "int", val);

// Anonymous memory that a cloned child inherits at the same addresses. The
// child gets a copy-on-write copy of the address space, so the parent may
// release its own mapping as soon as the clone exists.
const allocate = (length) => {
  const ptr = mmapRaw(null, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  const address = koffi.address(ptr);

  if (address === MAP_FAILED) {
    throw new Error(`mmap failed: ${koffi.errno()}`);
  }

  return {
    address,
    "bytes": Buffer.from(koffi.view(ptr, length)),
    "free": () => munmapRaw(ptr, length)
  };
};

const allocateStack = (length) => {
  const ptr = mmapRaw(null, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_STACK, -1, 0);
  const address = koffi.address(ptr);

  if (address === MAP_FAILED) {
    throw new Error(`mmap failed: ${koffi.errno()}`);
  }

  return {
    "topAddress": address + BigInt(length),
    "free": () => munmapRaw(ptr, length)
  };
};

// A page holding a snippet of machine code, inherited by a cloned child at the
// same address. Never writable and executable at the same time.
const allocateExecutable = (code) => {
  const page = allocate(4096);
  code.copy(page.bytes, 0);

  if (mprotectRaw(page.address, 4096, PROT_READ | PROT_EXEC) < 0) {
    page.free();
    throw new Error(`mprotect failed: ${koffi.errno()}`);
  }

  return {
    "address": page.address,
    "free": page.free
  };
};

const symbolAddress = (name) => {
  const ptr = dlsymRaw(null, name);
  if (!ptr) {
    throw new Error(`symbol '${name}' not found`);
  }
  return koffi.address(ptr);
};

// Starts a child that begins executing an existing native function instead of
// returning into the JavaScript runtime, which is what makes fork() fatal.
const cloneIntoFunction = ({ functionAddress, stackTopAddress, exitSignal }) => {
  const pid = cloneRaw(functionAddress, stackTopAddress, exitSignal, 0, 0, 0, 0);
  if (pid < 0) {
    throw new Error(`clone failed: ${koffi.errno()}`);
  }
  return pid;
};

const ptrace = (a, b, c, d) => {
  const res = ptraceRaw(a, b, c, d);
  if (res < 0) {
    throw new Error(`ptrace failed: ${koffi.errno()}`);
  }
};

// ptrace requests that exchange a whole structure (PTRACE_GETREGS and
// friends) need the layout at declaration time, so they get their own
// bindings per structure type.
const ptraceStructAccessor = (StructType) => {
  const readRaw = lib.func("ptrace", "long", ["int", "int", "void *", koffi.out(koffi.pointer(StructType))]);
  const writeRaw = lib.func("ptrace", "long", ["int", "int", "void *", koffi.pointer(StructType)]);

  const read = (request, pid, data) => {
    const res = readRaw(request, pid, null, data);
    if (res < 0) {
      throw new Error(`ptrace failed: ${koffi.errno()}`);
    }
  };

  const write = (request, pid, data) => {
    const res = writeRaw(request, pid, null, data);
    if (res < 0) {
      throw new Error(`ptrace failed: ${koffi.errno()}`);
    }
  };

  return {
    read,
    write
  };
};

const kill = (a, b) => {
  const res = killRaw(a, b);
  if (res < 0) {
    throw new Error(`kill failed: ${koffi.errno()}`);
  }
};

const execve = (path, argv) => {
  execvRaw(path, [...argv, null]);
  throw new Error(`execv failed: ${koffi.errno()}`);
};

export default {
  waitpid,
  dup,
  close,
  dup2,
  fcntl,
  allocate,
  allocateStack,
  allocateExecutable,
  symbolAddress,
  cloneIntoFunction,
  ptrace,
  ptraceStructAccessor,
  kill,
  execve
};
