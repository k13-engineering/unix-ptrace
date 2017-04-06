# unix-ptrace
unix-ptrace is a npm package that exposes a simple API for ptrace operations.

## API
TBD

## Usage examples
For examples, have a look at the examples folder.

## Supported architectures
Currently, only Linux on x86_64 is supported. The CPU register layout is architecture specific and therefore has to be implemented for the other architectures as well.

## Requirements
The source code is written using ES6 features and experimental async/await language features. Therefore a node.js version of >= 7.6 is required. Some lower versions also support async/await keywords with the --harmony-async-await flag.

## Promise vs Callback
For now the API is callback based. There are plans to support callback driven operation in parallel.
