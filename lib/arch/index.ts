import process from "node:process";

import { x86_64 } from "./x86_64.ts";
import { arm64 } from "./arm64.ts";

import type { TypeObject } from "koffi";

type TRegisterValue = number | bigint;
type TRegisters = Record<string, TRegisterValue>;

type TSyscallNumbers = {
  execve: number;
  fcntl: number;
};

type TArchitecture = {
  Registers: TypeObject;
  syscallNumbers: TSyscallNumbers;
  syscallTrampoline: Uint8Array;
  prepareSyscall: (params: {
    registers: TRegisters;
    address: bigint;
    number: number;
    args: readonly TRegisterValue[];
  }) => TRegisters;
  syscallResult: (params: { registers: TRegisters }) => bigint;
};

// keyed by process.arch, which is node's name for the host, not the kernel's
const architectures: Record<string, TArchitecture | undefined> = {
  x64: x86_64,
  arm64
};

const create = (): TArchitecture => {
  const selected = architectures[process.arch];

  if (selected === undefined) {
    throw Error(`unsupported architecture '${process.arch}'`);
  }

  return selected;
};

export {
  create
};

export type {
  TRegisterValue,
  TRegisters,
  TSyscallNumbers,
  TArchitecture
};
