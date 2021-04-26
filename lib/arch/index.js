import x86_64 from "./x86_64.js";

const create = () => {
  const structures = {
    "x64": x86_64
  }[process.arch];
  
  if (!structures) {
    throw new Error("unsupported architecture");
  }
  
  const { Registers } = structures;

  return {
    Registers
  };
};

export default {
  create
};
