const fs = require("fs");

const _promise = (fn) => {
  return new Promise((resolve, reject) => {
    fn((err, res) => {
      if (err) {
        reject(err);
      } else if (res < 0) {
        reject(res);
      } else {
        resolve();
      }
    });
  });
};

module.exports = new function () {
  this.accessor = (pid) => {
    return new function () {
      const _fd = () => _promise((cb) => fs.open(`/proc/${pid}/mem`, "r+", cb));

      this.peek = async (offset, size) => {
        const fd = await _fd();
        try {
          return await new Promise((resolve, reject) => {
            fs.read(fd, Buffer.alloc(size), 0, size, offset, (err, count, buffer) => {
              if (err) {
                reject(err);
              } else if (count === size) {
                resolve(buffer);
              } else {
                reject(new Error(`short read (${count}, expected = ${size})`));
              }
            });
          });
        } finally {
          fs.close(fd, () => {});
        }
      };

      this.poke = async (offset, data) => {
        const fd = await _fd();
        try {
          return await new Promise((resolve, reject) => {
            fs.write(fd, data, 0, data.length, offset, (err, written) => {
              if (err) {
                reject(err);
              } else if (written === data.length) {
                resolve();
              } else {
                reject(new Error("not all bytes have been written"));
              }
            });
          });
        } finally {
          fs.close(fd, () => {});
        }
      };

      this.close = async () => {
      };
    };
  };
};
