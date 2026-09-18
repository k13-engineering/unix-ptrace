import process from "node:process";

import { spawn } from "../lib/index.ts";

const traceSyscalls = async ({ path, args }: { path: string; args: readonly string[] }): Promise<void> => {
  const proc = await spawn({ path, args });

  const step = async ({ entering }: { entering: boolean }): Promise<boolean> => {
    const regs = await proc.regs();

    if (entering) {
      process.stdout.write(`\rsyscall ${regs.orig_rax}\r`);
    } else {
      process.stdout.write(`\rsyscall ${regs.orig_rax}, res = ${regs.rax}\n`);
    }

    proc.syscall();
    return !entering;
  };

  const loop = async ({ entering }: { entering: boolean }): Promise<boolean> => {
    const status = await proc.wait();

    if (status.exited() || status.signaled()) {
      return entering;
    }

    return await loop({ entering: await step({ entering }) });
  };

  const entering = await loop({ entering: false });

  if (!entering) {
    process.stdout.write("\n");
  }
};

const main = async (): Promise<void> => {
  try {
    await traceSyscalls({ path: "/bin/echo", args: ["Hello", "World!"] });
  } catch (ex) {
    console.error(ex);
  }
};

await main();
