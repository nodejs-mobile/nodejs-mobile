'use strict';

const {
  ArrayPrototypePush,
  SafePromiseAllReturnVoid,
  Promise,
  PromisePrototypeThen,
  SafeMap,
  SafeSet,
  StringPrototypeStartsWith,
  SymbolAsyncIterator,
} = primordials;

const { EventEmitter } = require('events');
const assert = require('internal/assert');
const {
  AbortError,
  codes: {
    ERR_INVALID_ARG_VALUE,
  },
} = require('internal/errors');
const { getValidatedPath } = require('internal/fs/utils');
const { kFSWatchStart, StatWatcher } = require('internal/fs/watchers');
const { kEmptyObject } = require('internal/util');
const { validateBoolean, validateAbortSignal } = require('internal/validators');
const {
  basename: pathBasename,
  join: pathJoin,
  relative: pathRelative,
  resolve: pathResolve,
} = require('path');

let internalSync;
let internalPromises;

function lazyLoadFsPromises() {
  internalPromises ??= require('fs/promises');
  return internalPromises;
}

function lazyLoadFsSync() {
  internalSync ??= require('fs');
  return internalSync;
}

async function traverse(dir, files = new SafeMap(), symbolicLinks = new SafeSet()) {
  const { opendir } = lazyLoadFsPromises();

  const filenames = await opendir(dir);
  const subdirectories = [];

  for await (const file of filenames) {
    const f = pathJoin(dir, file.name);

    files.set(f, file);

    // Do not follow symbolic links
    if (file.isSymbolicLink()) {
      symbolicLinks.add(f);
    } else if (file.isDirectory()) {
      ArrayPrototypePush(subdirectories, traverse(f, files));
    }
  }

  await SafePromiseAllReturnVoid(subdirectories);

  return files;
}

class FSWatcher extends EventEmitter {
  #options = null;
  #closed = false;
  #files = new SafeMap();
  #symbolicFiles = new SafeSet();
  #rootPath = pathResolve();
  #watchingFile = false;

  constructor(options = kEmptyObject) {
    super();

    assert(typeof options === 'object');

    const { persistent, recursive, signal, encoding } = options;

    // TODO(anonrig): Add non-recursive support to non-native-watcher for IBMi & AIX support.
    if (recursive != null) {
      validateBoolean(recursive, 'options.recursive');
    }

    if (persistent != null) {
      validateBoolean(persistent, 'options.persistent');
    }

    if (signal != null) {
      validateAbortSignal(signal, 'options.signal');
    }

    if (encoding != null) {
      // This is required since on macOS and Windows it throws ERR_INVALID_ARG_VALUE
      if (typeof encoding !== 'string') {
        throw new ERR_INVALID_ARG_VALUE(encoding, 'options.encoding');
      }
    }

    this.#options = { persistent, recursive, signal, encoding };
  }

  close() {
    if (this.#closed) {
      return;
    }

    const { unwatchFile } = lazyLoadFsSync();
    this.#closed = true;

    for (const file of this.#files.keys()) {
      unwatchFile(file);
    }

    this.#files.clear();
    this.#symbolicFiles.clear();
    this.emit('close');
  }

  #unwatchFiles(file) {
    const { unwatchFile } = lazyLoadFsSync();

    this.#symbolicFiles.delete(file);

    for (const filename of this.#files.keys()) {
      if (StringPrototypeStartsWith(filename, file)) {
        unwatchFile(filename);
      }
    }
  }

  async #watchFolder(folder) {
    const { opendir } = lazyLoadFsPromises();

    try {
      const files = await opendir(folder);

      for await (const file of files) {
        if (this.#closed) {
          break;
        }

        const f = pathJoin(folder, file.name);

        if (!this.#files.has(f)) {
          this.emit('change', 'rename', pathRelative(this.#rootPath, f));

          if (file.isSymbolicLink()) {
            this.#symbolicFiles.add(f);
          }

          if (file.isFile()) {
            this.#watchFile(f);
          } else {
            this.#files.set(f, file);

            if (file.isDirectory() && !file.isSymbolicLink()) {
              await this.#watchFolder(f);
            }
          }
        }
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  #watchFile(file) {
    if (this.#closed) {
      return;
    }

    const { watchFile } = lazyLoadFsSync();
    const existingStat = this.#files.get(file);

    watchFile(file, {
      persistent: this.#options.persistent,
    }, (currentStats, previousStats) => {
      if (existingStat && !existingStat.isDirectory() &&
        currentStats.nlink !== 0 && existingStat.mtimeMs === currentStats.mtimeMs) {
        return;
      }

      this.#files.set(file, currentStats);

      if (currentStats.birthtimeMs === 0 && previousStats.birthtimeMs !== 0) {
        // The file is now deleted
        this.#files.delete(file);
        this.emit('change', 'rename', pathRelative(this.#rootPath, file));
        this.#unwatchFiles(file);
      } else if (file === this.#rootPath && this.#watchingFile) {
        // This case will only be triggered when watching a file with fs.watch
        this.emit('change', 'change', pathBasename(file));
      } else if (this.#symbolicFiles.has(file)) {
        // Stats from watchFile does not return correct value for currentStats.isSymbolicLink()
        // Since it is only valid when using fs.lstat(). Therefore, check the existing symbolic files.
        this.emit('change', 'rename', pathRelative(this.#rootPath, file));
      } else if (currentStats.isDirectory()) {
        this.#watchFolder(file);
      }
    });
  }

  [kFSWatchStart](filename) {
    filename = pathResolve(getValidatedPath(filename));

    try {
      const file = lazyLoadFsSync().statSync(filename);

      this.#rootPath = filename;
      this.#closed = false;
      this.#watchingFile = file.isFile();

      if (file.isDirectory()) {
        this.#files.set(filename, file);

        PromisePrototypeThen(
          traverse(filename, this.#files, this.#symbolicFiles),
          () => {
            for (const f of this.#files.keys()) {
              this.#watchFile(f);
            }
          },
        );
      } else {
        this.#watchFile(filename);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        error.filename = filename;
        throw error;
      }
    }

  }

  ref() {
    this.#files.forEach((file) => {
      if (file instanceof StatWatcher) {
        file.ref();
      }
    });
  }

  unref() {
    this.#files.forEach((file) => {
      if (file instanceof StatWatcher) {
        file.unref();
      }
    });
  }

  [SymbolAsyncIterator]() {
    const { signal } = this.#options;
    const promiseExecutor = signal == null ?
      (resolve) => {
        this.once('change', (eventType, filename) => {
          resolve({ __proto__: null, value: { eventType, filename } });
        });
      } : (resolve, reject) => {
        const onAbort = () => reject(new AbortError(undefined, { cause: signal.reason }));
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { __proto__: null, once: true });
        this.once('change', (eventType, filename) => {
          signal.removeEventListener('abort', onAbort);
          resolve({ __proto__: null, value: { eventType, filename } });
        });
      };
    return {
      next: () => (this.#closed ?
        { __proto__: null, done: true } :
        new Promise(promiseExecutor)),
      [SymbolAsyncIterator]() { return this; },
    };
  }
}

module.exports = {
  FSWatcher,
  kFSWatchStart,
};
