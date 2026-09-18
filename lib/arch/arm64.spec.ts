import assert from "node:assert/strict";

import { describe, it } from "mocha";
import koffi from "koffi";

import { arm64 } from "./arm64.ts";

// struct user_pt_regs as the aarch64 kernel defines it: the order is part of
// the NT_PRSTATUS ABI, not a detail of this package
const kernelRegisterOrder = [
  ...Array.from({ length: 31 }).map((unused, index) => {
    return `x${index}`;
  }),
  "sp", "pc", "pstate"
];

const baseRegisters = { x8: 1n, x0: 2n, x1: 3n, x2: 4n, x3: 5n, x4: 6n, x5: 7n, pc: 8n, x19: 99n };

// each instruction is one little endian 32 bit word
const instruction = ({ word }: { word: number }): readonly number[] => {
  return [word & 0xff, word >> 8 & 0xff, word >> 16 & 0xff, word >> 24 & 0xff];
};

const SVC_0 = 0xd4000001;
const NEG_X0_X0 = 0xcb0003e0;
const MOV_X8_94 = 0xd2800bc8;

describe("arm64", () => {

  describe("Registers", () => {

    it("lays the registers out in the order the kernel expects", () => {
      const members = arm64.Registers.members ?? {};

      assert.deepEqual(Object.keys(members), kernelRegisterOrder);
    });

    it("is one 64 bit word per register, with no padding", () => {
      const members = arm64.Registers.members ?? {};
      const offsets = kernelRegisterOrder.map((name) => {
        return members[name]?.offset;
      });

      assert.equal(koffi.sizeof(arm64.Registers), kernelRegisterOrder.length * 8);
      assert.deepEqual(offsets, kernelRegisterOrder.map((_name, index) => {
        return index * 8;
      }));
    });
  });

  describe("syscallTrampoline", () => {

    it("starts with a supervisor call", () => {
      assert.deepEqual([...arm64.syscallTrampoline.slice(0, 4)], instruction({ word: SVC_0 }));
    });

    it("exits the tracee with the errno when the syscall returns", () => {
      const fallthrough = [
        ...instruction({ word: NEG_X0_X0 }),
        ...instruction({ word: MOV_X8_94 }),
        ...instruction({ word: SVC_0 })
      ];

      assert.deepEqual([...arm64.syscallTrampoline.slice(4)], fallthrough);
    });

    it("is whole instructions only, so the tracee cannot land mid-word", () => {
      assert.equal(arm64.syscallTrampoline.length % 4, 0);
    });
  });

  describe("syscallNumbers", () => {

    it("uses the asm-generic syscall numbers", () => {
      assert.deepEqual(arm64.syscallNumbers, { execve: 221, fcntl: 25 });
    });
  });

  describe("prepareSyscall", () => {

    const prepare = ({ args }: { args: readonly (number | bigint)[] }) => {
      return arm64.prepareSyscall({ registers: { ...baseRegisters }, address: 0x1000n, number: 221, args });
    };

    it("puts the syscall number in x8 and jumps to the given address", () => {
      const prepared = prepare({ args: [] });

      assert.equal(prepared.x8, 221);
      assert.equal(prepared.pc, 0x1000n);
    });

    it("passes arguments in x0 to x5", () => {
      const prepared = prepare({ args: [11, 22, 33, 44, 55, 66] });

      assert.deepEqual(
        [prepared.x0, prepared.x1, prepared.x2, prepared.x3, prepared.x4, prepared.x5],
        [11, 22, 33, 44, 55, 66]
      );
    });

    it("zeroes the argument registers it is not given, so nothing stale leaks into the syscall", () => {
      const prepared = prepare({ args: [11] });

      assert.deepEqual(
        [prepared.x0, prepared.x1, prepared.x2, prepared.x3, prepared.x4, prepared.x5],
        [11, 0, 0, 0, 0, 0]
      );
    });

    it("leaves registers that are not part of the call alone", () => {
      assert.equal(prepare({ args: [] }).x19, 99n);
    });

    it("does not modify the registers it was handed", () => {
      const registers = { ...baseRegisters };
      arm64.prepareSyscall({ registers, address: 0x1000n, number: 221, args: [11] });

      assert.deepEqual(registers, baseRegisters);
    });
  });

  describe("syscallResult", () => {

    it("reads the result out of x0", () => {
      assert.equal(arm64.syscallResult({ registers: { x0: 42n } }), 42n);
    });

    it("keeps a negated errno negative", () => {
      assert.equal(arm64.syscallResult({ registers: { x0: -2n } }), -2n);
    });

    it("reads a result that arrived as a number", () => {
      assert.equal(arm64.syscallResult({ registers: { x0: 7 } }), 7n);
    });

    it("reports zero when the register set carries no x0", () => {
      assert.equal(arm64.syscallResult({ registers: {} }), 0n);
    });
  });
});
