# unix-ptrace
unix-ptrace is a npm package that exposes a simple API for ptrace operations.

## API
TBD

## Usage examples
For examples, have a look at the examples folder.

## Supported architectures
Linux on x86_64 and on arm64. What differs per architecture is the register layout, the syscall calling convention, the syscall numbers and the machine code of the trampoline; everything else is shared. Adding an architecture means adding one module under `lib/arch/` and listing it in `lib/arch/index.ts`.

Registers are exchanged with `PTRACE_GETREGSET`/`PTRACE_SETREGSET` rather than `PTRACE_GETREGS`, which is an x86 legacy that arm64 never had.

Both architectures are exercised by CI on real hardware. Register names are the one thing a spec cannot write portably, so the specs take them from `lib/arch/host.fixture.ts` rather than naming `rip` or `pc` themselves.

## Requirements
node.js >= 20.19.0. The FFI bindings are provided by [koffi](https://koffi.dev), which ships prebuilt binaries, so no compiler or node-gyp toolchain is needed to install this package.

## How tracees are started
node.js cannot be `fork()`ed. The child segfaults inside V8's generated code before any JavaScript in the child branch runs, because after a fork the child may only do async-signal-safe work, and continuing to execute JavaScript is not that. This is a property of the runtime, not of the binding used to call `fork()`: raw `clone` through an N-API addon fails identically.

The way out is for the child never to return into the runtime at all. `spawn()` therefore:

1. allocates three mappings the child will inherit copy-on-write -- the `execve` argument block, a stack, and one page holding the architecture's syscall instruction;
2. calls `clone()` with libc's `pause()` as the child entry point, so the child enters a blocking syscall directly and never re-enters V8;
3. attaches with `PTRACE_ATTACH` and redirects the stopped child at the trampoline page to inject `fcntl(fd, F_SETFD, 0)` for stdin, stdout and stderr (node marks its own stdio `FD_CLOEXEC`, which would otherwise leave the target without descriptors 0, 1 and 2);
4. points the same trampoline at `execve` and continues.

The tracer's first stop is the target's own `execve`, before any of the target's code has run. No helper process is involved and a spawn costs a few milliseconds.

If the `execve` fails, it returns rather than replacing the image, so the trampoline ends in an `exit_group` that terminates the tracee with the `errno` as its exit code instead of running off the page. `spawn()` also rejects up front when the target is not executable.

## Promise vs Callback
For now the API is callback based. There are plans to support callback driven operation in parallel.
