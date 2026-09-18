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

export type {
  TRegisterValue,
  TRegisters,
  TSyscallNumbers,
  TArchitecture
};
