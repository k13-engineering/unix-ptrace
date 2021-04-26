const fs = require("fs");

const accessor = (pid) => {
  let fh;

  const reopen = async () => {
    if (fh) {
      await fh.close();
    }
    // eslint-disable-next-line
    fh = await fs.promises.open(`/proc/${pid}/mem`, "r+");
  };

  const peek = async (offset, size, { retry = true } = {}) => {
    if (!fh) {
      await reopen();
    }

    const { bytesRead, buffer } = await fh.read(Buffer.alloc(size), 0, size, offset);

    if (bytesRead === size) {
      return buffer;
    } else if (retry) {
      await reopen();
      return await peek(offset, size, { "retry": false });
    } else {
      throw new Error("short read");
    }
  };

  const poke = async (offset, data, { retry = true } = {}) => {
    if (!fh) {
      await reopen();
    }

    const { bytesWritten } = await fh.write(data, 0, data.length, offset);

    if (bytesWritten === data.length) {
      // OK
    } else if (retry) {
      await reopen();
      await poke(offset, data, { "retry": false });
    } else {
      throw new Error("short write");
    }
  };

  const close = async () => {
    if (fh) {
      await fh.close();
    }
  };

  return {
    peek,
    poke,
    close
  };
};

module.exports = {
  accessor
};
