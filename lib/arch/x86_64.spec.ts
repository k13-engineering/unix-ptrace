import assert from "node:assert/strict";

import { describe, it } from "mocha";
import koffi from "koffi";

import { x86_64 } from "./x86_64.ts";

// struct user_regs_struct as the x86_64 kernel defines it: the order is part
// of the PTRACE_GETREGS ABI, not a detail of this package
const kernelRegisterOrder = [
  "r15", "r14", "r13", "r12", "rbp", "rbx", "r11", "r10",
  "r9", "r8", "rax", "rcx", "rdx", "rsi", "rdi", "orig_rax",
  "rip", "cs", "eflags", "rsp", "ss", "fs_base", "gs_base",
  "ds", "es", "fs", "gs"
];

const baseRegisters = { rax: 1n, rdi: 2n, rsi: 3n, rdx: 4n, r10: 5n, r8: 6n, r9: 7n, rip: 8n, rbx: 99n };

describe("x86_64", () => {

  describe("Registers", () => {

    it("lays the registers out in the order the kernel expects", () => {
      const members = x86_64.Registers.members ?? {};

      assert.deepEqual(Object.keys(members), kernelRegisterOrder);
    });

    it("is one 64 bit word per register, with no padding", () => {
      const members = x86_64.Registers.members ?? {};
      const offsets = kernelRegisterOrder.map((name) => {
        return members[name]?.offset;
      });

      assert.equal(koffi.sizeof(x86_64.Registers), kernelRegisterOrder.length * 8);
      assert.deepEqual(offsets, kernelRegisterOrder.map((_name, index) => {
        return index * 8;
      }));
    });
  });

  describe("syscallTrampoline", () => {

    it("starts with a syscall instruction", () => {
      assert.deepEqual(x86_64.syscallTrampoline.slice(0, 2), new Uint8Array([0x0f, 0x05]));
    });

    it("exits the tracee with the errno when the syscall returns", () => {
      // neg %rax; mov %rax,%rdi; mov $231,%eax; syscall
      const fallthrough = new Uint8Array([
        0x48, 0xf7, 0xd8,
        0x48, 0x89, 0xc7,
        0xb8, 0xe7, 0x00, 0x00, 0x00,
        0x0f, 0x05
      ]);

      assert.deepEqual(x86_64.syscallTrampoline.slice(2), fallthrough);
    });
  });

  describe("syscallNumbers", () => {

    it("uses the x86_64 syscall numbers", () => {
      assert.deepEqual(x86_64.syscallNumbers, { execve: 59, fcntl: 72 });
    });
  });

  describe("prepareSyscall", () => {

    const prepare = ({ args }: { args: readonly (number | bigint)[] }) => {
      return x86_64.prepareSyscall({ registers: { ...baseRegisters }, address: 0x1000n, number: 59, args });
    };

    it("puts the syscall number in rax and jumps to the given address", () => {
      const prepared = prepare({ args: [] });

      assert.equal(prepared.rax, 59);
      assert.equal(prepared.rip, 0x1000n);
    });

    it("passes arguments in rdi, rsi, rdx, r10, r8 and r9", () => {
      const prepared = prepare({ args: [11, 22, 33, 44, 55, 66] });

      assert.deepEqual(
        [prepared.rdi, prepared.rsi, prepared.rdx, prepared.r10, prepared.r8, prepared.r9],
        [11, 22, 33, 44, 55, 66]
      );
    });

    it("zeroes the argument registers it is not given, so nothing stale leaks into the syscall", () => {
      const prepared = prepare({ args: [11] });

      assert.deepEqual(
        [prepared.rdi, prepared.rsi, prepared.rdx, prepared.r10, prepared.r8, prepared.r9],
        [11, 0, 0, 0, 0, 0]
      );
    });

    it("leaves registers that are not part of the call alone", () => {
      assert.equal(prepare({ args: [] }).rbx, 99n);
    });

    it("does not modify the registers it was handed", () => {
      const registers = { ...baseRegisters };
      x86_64.prepareSyscall({ registers, address: 0x1000n, number: 59, args: [11] });

      assert.deepEqual(registers, baseRegisters);
    });
  });

  describe("syscallResult", () => {

    it("reads the result out of rax", () => {
      assert.equal(x86_64.syscallResult({ registers: { rax: 42n } }), 42n);
    });

    it("keeps a negated errno negative", () => {
      assert.equal(x86_64.syscallResult({ registers: { rax: -2n } }), -2n);
    });

    it("reads a result that arrived as a number", () => {
      assert.equal(x86_64.syscallResult({ registers: { rax: 7 } }), 7n);
    });

    it("reports zero when the register set carries no rax", () => {
      assert.equal(x86_64.syscallResult({ registers: {} }), 0n);
    });
  });
});
