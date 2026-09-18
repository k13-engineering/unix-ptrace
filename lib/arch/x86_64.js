import koffi from "koffi";

const Registers = koffi.struct("user_regs_struct_x86_64", {
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

const syscallNumbers = {
  "execve": 59,
  "fcntl": 72
};

// Code the tracee is pointed at to perform an injected syscall. execve() only
// returns when it failed, so falling through has to terminate the tracee
// rather than run off the end of the page.
//
//   0f 05              syscall
//   48 f7 d8           neg  %rax          -errno -> errno
//   48 89 c7           mov  %rax, %rdi    exit code
//   b8 e7 00 00 00     mov  $231, %eax    SYS_exit_group
//   0f 05              syscall
const syscallTrampoline = Buffer.from([
  0x0f, 0x05,
  0x48, 0xf7, 0xd8,
  0x48, 0x89, 0xc7,
  0xb8, 0xe7, 0x00, 0x00, 0x00,
  0x0f, 0x05
]);

// System V AMD64 syscall convention: number in rax, arguments in
// rdi/rsi/rdx/r10/r8/r9, result in rax
const syscallArgumentRegisters = ["rdi", "rsi", "rdx", "r10", "r8", "r9"];

const prepareSyscall = ({ registers, address, number, args }) => {
  const passed = Object.fromEntries(syscallArgumentRegisters.map((name, index) => [name, args[index] || 0]));

  return {
    ...registers,
    ...passed,
    "rip": address,
    "rax": number
  };
};

const syscallResult = ({ registers }) => BigInt(registers.rax);

export default {
  Registers,
  syscallNumbers,
  syscallTrampoline,
  prepareSyscall,
  syscallResult
};
