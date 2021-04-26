import ffi from "ffi-napi";
import ref from "ref-napi";

const lib = ffi.Library(null, {
  "waitpid": ["int", ["int", "pointer", "int"]],
  "fork": ["int", []],
  "ptrace": ["int", ["int", "int", "pointer", "pointer"]],
  "kill": ["int", ["int", "int"]],
  "execl": ["int", ["string", "string"], { "varargs": true }],
  "fcntl": ["int", ["int", "int", "int"]],
  "dup": ["int", ["int"]],
  "dup2": ["int", ["int", "int"]],
  "close": ["int", ["int"]]
});

const _status = (status) => {
  return new function () {
    const code = status;


    const exited = () => {
      return ((status & 0o177) === 0);
    };

    const stopped = () => {
      return (status & 0x02) === 0x02;
    };

    const continued = () => {
      return (status & 0x08) === 0x08;
    };

    const toString = () => {
      let str = "status";
      str += exited() ? " [exited]" : "";
      str += stopped() ? " [stopped]" : "";
      str += continued() ? " [continued]" : "";
      return str;
    };

    return {
      code,
      exited,
      stopped,
      continued,
      toString
    };
  };
};

const waitpid = async (pid, options) => {
  const status = await new Promise((resolve, reject) => {
    const sptr = ref.alloc("int");
    lib.waitpid.async(pid, sptr, options, (err, res) => {
      if (err) {
        reject(err);
      } else if (res < 0) {
        reject(ffi.errno());
      } else {
        resolve(sptr.deref());
      }
    });
  });

  return _status(status);
};

const dup = (fd) => {
  const res = lib.dup(fd);
  if (res < 0) {
    throw new Error(`failed to dup: ${ffi.errno()}`);
  }
};

const close = (fd) => lib.close(fd);

const dup2 = (ofd, nfd) => {
  const res = lib.dup2(ofd, nfd);
  if (res < 0) {
    throw new Error(`failed to dup: ${ffi.errno()}`);
  }
};

const fcntl = (fd, cmd, val) => lib.fcntl(fd, cmd, val);
const fork = () => lib.fork();
const ptrace = (a, b, c, d) => {
  const res = lib.ptrace(a, b, c, d);
  if (res < 0) {
    throw new Error(`ptrace failed: ${ffi.errno()}`);
  }
};
const kill = (a, b) => {
  const res = lib.kill(a, b);
  if (res < 0) {
    throw new Error(`kill failed: ${ffi.errno()}`);
  }
};
const execve = (path, argv) => {
  const args = [path].concat(argv).concat([null]);
  lib.execl(...args.slice(2).map(() => "string"))(...args);
  throw new Error(ffi.errno());
};

export default {
  waitpid,
  dup,
  close,
  dup2,
  fcntl,
  fork,
  ptrace,
  kill,
  execve
};
