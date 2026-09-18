import fs from "node:fs";

type TMemoryAccessor = {
  peek: (params: { offset: number; size: number }) => Promise<Uint8Array>;
  poke: (params: { offset: number; data: Uint8Array }) => Promise<void>;
  close: () => Promise<void>;
};

// /proc/<pid>/mem handles do not survive the tracee replacing its image, so a
// short transfer is retried once against a freshly opened handle.
const accessorFor = ({ pid }: { pid: number }): TMemoryAccessor => {
  const path = `/proc/${pid}/mem`;

  let pending: Promise<fs.promises.FileHandle> | undefined = undefined;

  const closeHandle = async ({ handle }: {
    handle: Promise<fs.promises.FileHandle> | undefined;
  }): Promise<void> => {
    if (handle === undefined) {
      return;
    }

    await (await handle).close();
  };

  const reopen = async (): Promise<fs.promises.FileHandle> => {
    const previous = pending;
    const next = fs.promises.open(path, "r+");
    pending = next;

    await closeHandle({ handle: previous });

    return await next;
  };

  const open = async (): Promise<fs.promises.FileHandle> => {
    const existing = pending;

    if (existing !== undefined) {
      return await existing;
    }

    return await reopen();
  };

  const peek = async ({ offset, size, retry = true }: {
    offset: number;
    size: number;
    retry?: boolean;
  }): Promise<Uint8Array> => {
    const file = await open();
    const { bytesRead, buffer } = await file.read(new Uint8Array(size), 0, size, offset);

    if (bytesRead === size) {
      return buffer;
    }

    if (!retry) {
      throw Error(`short read of ${bytesRead} of ${size} bytes at 0x${offset.toString(16)}`);
    }

    await reopen();
    return await peek({ offset, size, retry: false });
  };

  const poke = async ({ offset, data, retry = true }: {
    offset: number;
    data: Uint8Array;
    retry?: boolean;
  }): Promise<void> => {
    const file = await open();
    const { bytesWritten } = await file.write(data, 0, data.length, offset);

    if (bytesWritten === data.length) {
      return;
    }

    if (!retry) {
      throw Error(`short write of ${bytesWritten} of ${data.length} bytes at 0x${offset.toString(16)}`);
    }

    await reopen();
    await poke({ offset, data, retry: false });
  };

  const close = async (): Promise<void> => {
    const previous = pending;
    pending = undefined;

    await closeHandle({ handle: previous });
  };

  return { peek, poke, close };
};

export {
  accessorFor
};

export type {
  TMemoryAccessor
};
