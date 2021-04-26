#!/usr/bin/env node

const ptrace = require("../index.js");

const spawnAndLog = async (...args) => {
  const proc = await ptrace.spawn(...args);

  let state = "leave";
  let status = await proc.wait();

  while (!status.exited()) {
    const r = await proc.regs();
    if (state === "enter") {
      process.stdout.write(`\rsyscall ${r.orig_rax}\r`);
    } else {
      process.stdout.write(`\rsyscall ${r.orig_rax}, res = ${r.rax}\n`);
    }

    proc.syscall();
    state = state === "enter" ? "leave" : "enter";

    status = await proc.wait();
  }

  if (state === "leave") {
    process.stdout.write("\n");
  }
};

const main = async () => {
  try {
    await spawnAndLog("/bin/echo", ["Hello", "World!"]);
  } catch (ex) {
    console.error(ex);
  }
};
main();
