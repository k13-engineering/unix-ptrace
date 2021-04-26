import Struct from "ref-struct-napi";

const Registers = Struct({
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

export default {
  Registers
};
