# unix-ptrace
unix-ptrace is a npm package that exposes a simple API for ptrace operations.

## API
TBD

## Usage examples
For examples, have a look at the examples folder.

## Supported architectures
Currently, only Linux on x86_64 is supported. The CPU register layout is architecture specific and therefore has to be implemented for the other architectures as well.

## Requirements
node.js >= 20.19.0. The FFI bindings are provided by [koffi](https://koffi.dev), which ships prebuilt binaries, so no compiler or node-gyp toolchain is needed to install this package.

## Promise vs Callback
For now the API is callback based. There are plans to support callback driven operation in parallel.
