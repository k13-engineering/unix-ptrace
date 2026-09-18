import fs from "node:fs";

type TMemoryAccessor = {
  peek: (params: { offset: number; size: number }) => Uint8Array;
  poke: (params: { offset: number; data: Uint8Array }) => void;
  close: () => void;
};

// /proc/<pid>/mem descriptors do not survive the tracee replacing its image,
// so a short transfer is retried once against a freshly opened descriptor.
const accessorFor = ({ pid }: { pid: number }): TMemoryAccessor => {
  const path = `/proc/${pid}/mem`;

  let descriptor: number | undefined = undefined;

  const close = (): void => {
    const previous = descriptor;
    descriptor = undefined;

    if (previous !== undefined) {
      fs.closeSync(previous);
    }
  };

  const reopen = (): number => {
    close();
    const opened = fs.openSync(path, "r+");
    descriptor = opened;

    return opened;
  };

  const open = (): number => {
    if (descriptor !== undefined) {
      return descriptor;
    }

    return reopen();
  };

  const peek = ({ offset, size, retry = true }: {
    offset: number;
    size: number;
    retry?: boolean;
  }): Uint8Array => {
    const buffer = new Uint8Array(size);
    const bytesRead = fs.readSync(open(), buffer, 0, size, offset);

    if (bytesRead === size) {
      return buffer;
    }

    if (!retry) {
      throw Error(`short read of ${bytesRead} of ${size} bytes at 0x${offset.toString(16)}`);
    }

    reopen();
    return peek({ offset, size, retry: false });
  };

  const poke = ({ offset, data, retry = true }: {
    offset: number;
    data: Uint8Array;
    retry?: boolean;
  }): void => {
    const bytesWritten = fs.writeSync(open(), data, 0, data.length, offset);

    if (bytesWritten === data.length) {
      return;
    }

    if (!retry) {
      throw Error(`short write of ${bytesWritten} of ${data.length} bytes at 0x${offset.toString(16)}`);
    }

    reopen();
    poke({ offset, data, retry: false });
  };

  return { peek, poke, close };
};

export {
  accessorFor
};

export type {
  TMemoryAccessor
};
