import process from "node:process";

import type { TRegisters } from "./index.ts";

// Register names are the one thing a spec cannot write portably: a test that
// pokes at a real register has to name a real register. Each host names the
// ones the specs need, so the specs themselves stay architecture agnostic.
type THostRegisters = {
  count: number;
  programCounter: string;
  stackPointer: string;
  scratch: string;
  freshExecMarks: (params: { registers: TRegisters }) => Record<string, unknown>;
  freshExecExpected: Record<string, unknown>;
};

const SYS_EXECVE_X86_64 = 59;
const ARM64_GENERAL_PURPOSE_COUNT = 31;

const nonZeroGeneralPurpose = ({ registers }: { registers: TRegisters }): readonly string[] => {
  return Array.from({ length: ARM64_GENERAL_PURPOSE_COUNT }).map((unused, index) => {
    return `x${index}`;
  }).filter((name) => {
    return Number(registers[name]) !== 0;
  });
};

// A target that has been exec'd but has not run yet looks different per
// architecture: x86_64 keeps the syscall number in orig_rax across the exec,
// while aarch64 wipes the whole register file, so there the mark is that no
// general purpose register holds anything.
const hosts: Record<string, THostRegisters | undefined> = {
  x64: {
    count: 27,
    programCounter: "rip",
    stackPointer: "rsp",
    scratch: "r15",
    freshExecMarks: ({ registers }) => {
      return { syscallNumber: Number(registers.orig_rax) };
    },
    freshExecExpected: { syscallNumber: SYS_EXECVE_X86_64 }
  },
  arm64: {
    count: 34,
    programCounter: "pc",
    stackPointer: "sp",
    scratch: "x19",
    freshExecMarks: ({ registers }) => {
      return { nonZero: nonZeroGeneralPurpose({ registers }) };
    },
    freshExecExpected: { nonZero: [] }
  }
};

const hostRegisters = (): THostRegisters => {
  const selected = hosts[process.arch];

  if (selected === undefined) {
    throw Error(`the specs have no register names for architecture '${process.arch}'`);
  }

  return selected;
};

export {
  hostRegisters
};

export type {
  THostRegisters
};
