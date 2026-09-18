import koffi from "koffi";

import type { TRegisters, TRegisterValue, TArchitecture } from "./index.ts";

const GENERAL_PURPOSE_COUNT = 31;

// struct user_pt_regs: x0 to x30, then the stack pointer, the program counter
// and the processor state. Generated rather than spelled out, so the order
// cannot drift from the NT_PRSTATUS layout the kernel writes.
const generalPurpose = Object.fromEntries(Array.from({ length: GENERAL_PURPOSE_COUNT }).map((unused, index) => {
  const member: [string, string] = [`x${index}`, "int64"];

  return member;
}));

const Registers = koffi.struct("user_pt_regs_arm64", {
  ...generalPurpose,
  sp: "int64",
  pc: "int64",
  pstate: "int64"
});

// aarch64 uses the asm-generic numbers, which share nothing with x86_64's
const syscallNumbers = {
  execve: 221,
  fcntl: 25
};

// Code the tracee is pointed at to perform an injected syscall. execve() only
// returns when it failed, so falling through has to terminate the tracee
// rather than run off the end of the page.
//
//   d4000001           svc  #0
//   cb0003e0           neg  x0, x0        -errno -> errno, and the exit code
//   d2800bc8           mov  x8, #94       SYS_exit_group
//   d4000001           svc  #0
const syscallTrampoline = new Uint8Array([
  0x01, 0x00, 0x00, 0xd4,
  0xe0, 0x03, 0x00, 0xcb,
  0xc8, 0x0b, 0x80, 0xd2,
  0x01, 0x00, 0x00, 0xd4
]);

// AArch64 syscall convention: number in x8, arguments in x0 to x5, result in x0
const syscallArgumentRegisters = ["x0", "x1", "x2", "x3", "x4", "x5"];

const prepareSyscall = ({ registers, address, number, args }: {
  registers: TRegisters;
  address: bigint;
  number: number;
  args: readonly TRegisterValue[];
}): TRegisters => {
  const passed = Object.fromEntries(syscallArgumentRegisters.map((name, index) => {
    return [name, args[index] ?? 0];
  }));

  return {
    ...registers,
    ...passed,
    pc: address,
    x8: number
  };
};

const syscallResult = ({ registers }: { registers: TRegisters }): bigint => {
  return BigInt(registers.x0 ?? 0);
};

const arm64: TArchitecture = {
  Registers,
  syscallNumbers,
  syscallTrampoline,
  prepareSyscall,
  syscallResult
};

export {
  arm64
};
