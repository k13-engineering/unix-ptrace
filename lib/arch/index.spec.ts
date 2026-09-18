import assert from "node:assert/strict";
import process from "node:process";

import { describe, it, afterEach } from "mocha";

import { create } from "./index.ts";
import { architecture } from "./x86_64.ts";

const describedArch = Object.getOwnPropertyDescriptor(process, "arch");

const pretendArch = ({ value }: { value: string }) => {
  Reflect.defineProperty(process, "arch", { value, configurable: true });
};

describe("arch", () => {

  afterEach(() => {
    if (describedArch !== undefined) {
      Reflect.defineProperty(process, "arch", describedArch);
    }
  });

  it("gives the x86_64 support on an x86_64 host", () => {
    pretendArch({ value: "x64" });

    assert.equal(create(), architecture);
  });

  it("refuses to run on an architecture it has no register layout for", () => {
    pretendArch({ value: "arm64" });

    assert.throws(() => {
      create();
    }, /unsupported architecture 'arm64'/);
  });
});
