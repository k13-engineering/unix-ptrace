import koffi from "koffi";

const lib = koffi.load(null);

const waitpidRaw = lib.func("waitpid", "int", ["int", koffi.out(koffi.pointer("int")), "int"]);
const forkRaw = lib.func("fork", "int", []);
const ptraceRaw = lib.func("ptrace", "long", ["int", "int", "void *", "void *"]);
const killRaw = lib.func("kill", "int", ["int", "int"]);
const execvRaw = lib.func("execv", "int", ["str", koffi.pointer("str")]);
const fcntlRaw = lib.func("int fcntl(int fd, int cmd, ...)");
const dupRaw = lib.func("dup", "int", ["int"]);
const dup2Raw = lib.func("dup2", "int", ["int", "int"]);
const closeRaw = lib.func("close", "int", ["int"]);

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

const fork = () => forkRaw();

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
  fork,
  ptrace,
  ptraceStructAccessor,
  kill,
  execve
};
