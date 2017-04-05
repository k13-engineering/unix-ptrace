const ffi = require("ffi");
const ref = require("ref");

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

const lib = ffi.Library(null, {
	"waitpid": ["int", ["int", "pointer", "int"]],
	"fork": ["int", []],
	"ptrace": ["int", ["int", "int", "pointer", "pointer"]],
	"kill": ["int", ["int", "int"]],
	"execl": ["int", ["string", "string"], { varargs: true }],
	"fcntl": ["int", ["int", "int", "int"]],
	"dup": ["int", ["int"]],
	"dup2": ["int", ["int", "int"]],
	"close": ["int", ["int"]]
});

const _status = (status) => {
	return new function () {
		this.code = status;
		this.exited = () => !!((status & 0177) === 0);
		this.stopped = () => !!(status & 0x02);
		this.continued = () => !!(status & 0x08);
		this.toString = () => {
			let str = "status";
			str += this.exited() ? " [exited]" : "";
			str += this.stopped() ? " [stopped]" : "";
			str += this.continued() ? " [continued]" : "";
			return str;
		};
	};
};

module.exports = new function () {
	this.waitpid = async(pid, options) => {
		const status = await new Promise((resolve, reject) => {
			let sptr = ref.alloc("int");
			lib.waitpid.async(pid, sptr, options, (err, res) => {
				if (err) {
					reject(err);
				} else if (res < 0) {
					reject(ffi.errno());
				} else {
					resolve(sptr.deref());
				}
			});
		});

		return _status(status);
	}

	this.dup = (fd) => {
		const res = lib.dup(fd);
		if (res < 0) {
			throw new Error("failed to dup: " + ffi.errno());
		}
	};

	this.close = (fd) => lib.close(fd);

	this.dup2 = (ofd, nfd) => {
		const res = lib.dup2(ofd, nfd);
		if (res < 0) {
			throw new Error("failed to dup: " + ffi.errno());
		}
	};

	this.fcntl = (fd, cmd, val) => lib.fcntl(fd, cmd, val);
	this.fork = () => lib.fork();
	this.ptrace = (a, b, c, d) => {
		let res = lib.ptrace(a, b, c, d);
		if (res < 0) {
			throw new Error("ptrace failed: " + ffi.errno());
		}
	};
	this.kill = (a, b) => {
		let res = lib.kill(a, b);
		if (res < 0) {
			throw new Error("kill failed: " + ffi.errno());
		}
	};
	this.execve = (path, argv, envp) => {
		const args = [path].concat(argv).concat([null]);
		lib.execl(...args.slice(2).map(() => "string"))(...args);
		throw new Error(ffi.errno());
	}
};
