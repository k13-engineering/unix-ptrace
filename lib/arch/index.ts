import process from "node:process";

import { architecture } from "./x86_64.ts";

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

const architectures: Record<string, TArchitecture | undefined> = {
  x64: architecture
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
