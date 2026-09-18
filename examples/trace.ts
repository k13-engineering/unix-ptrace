import process from "node:process";

import { spawn } from "../lib/index.ts";

// spawn() inherits nothing on its own, and node's own environment carries
// undefined values that execve() has no way to express.
const inheritedEnvironment = (): Record<string, string> => {
  return Object.entries(process.env).reduce<Record<string, string>>((env, [key, value]) => {
    return value === undefined ? env : { ...env, [key]: value };
  }, {});
};

const traceSyscalls = async ({ path, args }: { path: string; args: readonly string[] }): Promise<void> => {
  const proc = spawn({ path, args, env: inheritedEnvironment() });

  const step = ({ entering }: { entering: boolean }): boolean => {
    const regs = proc.regs();

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

    if (status.type === "exited" || status.type === "signaled") {
      return entering;
    }

    return await loop({ entering: step({ entering }) });
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
