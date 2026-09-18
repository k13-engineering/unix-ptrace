import process from "node:process";

import { architecture } from "./x86_64.ts";

import type { TArchitecture } from "./types.ts";

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
