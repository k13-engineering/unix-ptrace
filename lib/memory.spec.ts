import assert from "node:assert/strict";
import process from "node:process";

import { describe, it } from "mocha";
import koffi from "koffi";

import { accessorFor } from "./memory.ts";
import { allocate } from "./unix.ts";

const PAGE_SIZE = 4096;
const PROT_READ_WRITE = 0x3;
const MAP_PRIVATE_ANONYMOUS = 0x22;

const lib = koffi.load(null);
const mmap = lib.func("void *mmap(void *addr, size_t length, int prot, int flags, int fd, int64_t offset)");
const munmap = lib.func("int munmap(void *addr, size_t length)");

const encoder = new TextEncoder();

// one mapped page followed by a hole, so a transfer across the boundary can
// only ever be partial
const mapTornRegion = () => {
  const pointer = mmap(null, 2 * PAGE_SIZE, PROT_READ_WRITE, MAP_PRIVATE_ANONYMOUS, -1, 0);
  const address = koffi.address(pointer);
  munmap(address + BigInt(PAGE_SIZE), PAGE_SIZE);

  return {
    readableEnd: Number(address) + PAGE_SIZE,
    free: () => {
      munmap(address, PAGE_SIZE);
    }
  };
};

describe("memory", () => {

  const ourMemory = () => {
    return accessorFor({ pid: process.pid });
  };

  describe("peek", () => {

    it("reads what is really at the address", () => {
      const memory = ourMemory();
      const region = allocate({ length: PAGE_SIZE });
      region.bytes.set(encoder.encode("ptrace"), 0);

      assert.deepEqual(memory.peek({ offset: Number(region.address), size: 6 }), encoder.encode("ptrace"));

      memory.close();
      region.free();
    });

    it("reads exactly the number of bytes asked for", () => {
      const memory = ourMemory();
      const region = allocate({ length: PAGE_SIZE });

      assert.equal(memory.peek({ offset: Number(region.address), size: 64 }).length, 64);

      memory.close();
      region.free();
    });

    it("reports a read that cannot be satisfied in full", () => {
      const memory = ourMemory();
      const region = mapTornRegion();

      assert.throws(() => {
        memory.peek({ offset: region.readableEnd - 8, size: 16 });
      }, /short read/);

      memory.close();
      region.free();
    });

    it("reports a read from an address that is not mapped", () => {
      const memory = ourMemory();

      assert.throws(() => {
        memory.peek({ offset: 0x1000, size: 8 });
      });

      memory.close();
    });
  });

  describe("poke", () => {

    it("writes through to the address", () => {
      const memory = ourMemory();
      const region = allocate({ length: PAGE_SIZE });

      memory.poke({ offset: Number(region.address), data: encoder.encode("written") });

      assert.deepEqual(region.bytes.slice(0, 7), encoder.encode("written"));

      memory.close();
      region.free();
    });

    it("reports a write that cannot be satisfied in full", () => {
      const memory = ourMemory();
      const region = mapTornRegion();

      assert.throws(() => {
        memory.poke({ offset: region.readableEnd - 8, data: new Uint8Array(16) });
      }, /short write/);

      memory.close();
      region.free();
    });

    it("reports a write to an address that is not mapped", () => {
      const memory = ourMemory();

      assert.throws(() => {
        memory.poke({ offset: 0x1000, data: new Uint8Array(8) });
      });

      memory.close();
    });
  });

  describe("close", () => {

    it("can be called before anything was read", () => {
      const memory = ourMemory();

      assert.doesNotThrow(() => {
        memory.close();
      });
    });

    it("leaves the accessor usable, reopening on the next access", () => {
      const memory = ourMemory();
      const region = allocate({ length: PAGE_SIZE });
      region.bytes.set(encoder.encode("again"), 0);

      memory.peek({ offset: Number(region.address), size: 5 });
      memory.close();

      assert.deepEqual(memory.peek({ offset: Number(region.address), size: 5 }), encoder.encode("again"));

      memory.close();
      region.free();
    });

    it("can be called more than once", () => {
      const memory = ourMemory();
      memory.close();

      assert.doesNotThrow(() => {
        memory.close();
      });
    });
  });
});
