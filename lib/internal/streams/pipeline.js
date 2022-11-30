// Ported from https://github.com/mafintosh/pump with
// permission from the author, Mathias Buus (@mafintosh).

'use strict';

const {
  ArrayIsArray,
  Promise,
  SymbolAsyncIterator,
} = primordials;

const eos = require('internal/streams/end-of-stream');
const { once } = require('internal/util');
const destroyImpl = require('internal/streams/destroy');
const Duplex = require('internal/streams/duplex');
const {
  aggregateTwoErrors,
  codes: {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_RETURN_VALUE,
    ERR_MISSING_ARGS,
    ERR_STREAM_DESTROYED,
  },
  AbortError,
} = require('internal/errors');

const {
  validateCallback,
  validateAbortSignal
} = require('internal/validators');

const {
  isIterable,
  isReadableNodeStream,
  isNodeStream,
  isReadableFinished,
} = require('internal/streams/utils');
const { AbortController } = require('internal/abort_controller');

let PassThrough;
let Readable;

function destroyer(stream, reading, writing, callback) {
  callback = once(callback);

  let finished = false;
  stream.on('close', () => {
    finished = true;
  });

  eos(stream, { readable: reading, writable: writing }, (err) => {
    finished = !err;

    const rState = stream._readableState;
    if (
      err &&
      err.code === 'ERR_STREAM_PREMATURE_CLOSE' &&
      reading &&
      (rState && rState.ended && !rState.errored && !rState.errorEmitted)
    ) {
      // Some readable streams will emit 'close' before 'end'. However, since
      // this is on the readable side 'end' should still be emitted if the
      // stream has been ended and no error emitted. This should be allowed in
      // favor of backwards compatibility. Since the stream is piped to a
      // destination this should not result in any observable difference.
      // We don't need to check if this is a writable premature close since
      // eos will only fail with premature close on the reading side for
      // duplex streams.
      stream
        .once('end', callback)
        .once('error', callback);
    } else {
      callback(err);
    }
  });

  return (err) => {
    if (finished) return;
    finished = true;
    destroyImpl.destroyer(stream, err);
    callback(err || new ERR_STREAM_DESTROYED('pipe'));
  };
}

function popCallback(streams) {
  // Streams should never be an empty array. It should always contain at least
  // a single stream. Therefore optimize for the average case instead of
  // checking for length === 0 as well.
  validateCallback(streams[streams.length - 1]);
  return streams.pop();
}

function makeAsyncIterable(val) {
  if (isIterable(val)) {
    return val;
  } else if (isReadableNodeStream(val)) {
    // Legacy streams are not Iterable.
    return fromReadable(val);
  }
  throw new ERR_INVALID_ARG_TYPE(
    'val', ['Readable', 'Iterable', 'AsyncIterable'], val);
}

async function* fromReadable(val) {
  if (!Readable) {
    Readable = require('internal/streams/readable');
  }

  yield* Readable.prototype[SymbolAsyncIterator].call(val);
}

async function pump(iterable, writable, finish, opts) {
  let error;
  let onresolve = null;

  const resume = (err) => {
    if (err) {
      error = err;
    }

    if (onresolve) {
      const callback = onresolve;
      onresolve = null;
      callback();
    }
  };

  const wait = () => new Promise((resolve, reject) => {
    if (error) {
      reject(error);
    } else {
      onresolve = () => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
    }
  });

  writable.on('drain', resume);
  const cleanup = eos(writable, { readable: false }, resume);

  try {
    if (writable.writableNeedDrain) {
      await wait();
    }

    for await (const chunk of iterable) {
      if (!writable.write(chunk)) {
        await wait();
      }
    }

    if (opts?.end !== false) {
      writable.end();
    }

    await wait();

    finish();
  } catch (err) {
    finish(error !== err ? aggregateTwoErrors(error, err) : err);
  } finally {
    cleanup();
    writable.off('drain', resume);
  }
}

function pipeline(...streams) {
  return pipelineImpl(streams, once(popCallback(streams)));
}

function pipelineImpl(streams, callback, opts) {
  if (streams.length === 1 && ArrayIsArray(streams[0])) {
    streams = streams[0];
  }

  if (streams.length < 2) {
    throw new ERR_MISSING_ARGS('streams');
  }

  const ac = new AbortController();
  const signal = ac.signal;
  const outerSignal = opts?.signal;

  validateAbortSignal(outerSignal, 'options.signal');

  function abort() {
    finishImpl(new AbortError());
  }

  outerSignal?.addEventListener('abort', abort);

  let error;
  let value;
  const destroys = [];

  let finishCount = 0;

  function finish(err) {
    finishImpl(err, --finishCount === 0);
  }

  function finishImpl(err, final) {
    if (err && (!error || error.code === 'ERR_STREAM_PREMATURE_CLOSE')) {
      error = err;
    }

    if (!error && !final) {
      return;
    }

    while (destroys.length) {
      destroys.shift()(error);
    }

    outerSignal?.removeEventListener('abort', abort);
    ac.abort();

    if (final) {
      callback(error, value);
    }
  }

  let ret;
  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i];
    const reading = i < streams.length - 1;
    const writing = i > 0;
    const end = reading || opts?.end !== false;

    if (isNodeStream(stream)) {
      if (end) {
        finishCount++;
        destroys.push(destroyer(stream, reading, writing, (err) => {
          if (!err && !reading && isReadableFinished(stream, false)) {
            stream.read(0);
            destroyer(stream, true, writing, finish);
          } else {
            finish(err);
          }
        }));
      } else {
        stream.on('error', finish);
      }
    }

    if (i === 0) {
      if (typeof stream === 'function') {
        ret = stream({ signal });
        if (!isIterable(ret)) {
          throw new ERR_INVALID_RETURN_VALUE(
            'Iterable, AsyncIterable or Stream', 'source', ret);
        }
      } else if (isIterable(stream) || isReadableNodeStream(stream)) {
        ret = stream;
      } else {
        ret = Duplex.from(stream);
      }
    } else if (typeof stream === 'function') {
      ret = makeAsyncIterable(ret);
      ret = stream(ret, { signal });

      if (reading) {
        if (!isIterable(ret, true)) {
          throw new ERR_INVALID_RETURN_VALUE(
            'AsyncIterable', `transform[${i - 1}]`, ret);
        }
      } else {
        if (!PassThrough) {
          PassThrough = require('internal/streams/passthrough');
        }

        // If the last argument to pipeline is not a stream
        // we must create a proxy stream so that pipeline(...)
        // always returns a stream which can be further
        // composed through `.pipe(stream)`.

        const pt = new PassThrough({
          objectMode: true
        });

        // Handle Promises/A+ spec, `then` could be a getter that throws on
        // second use.
        const then = ret?.then;
        if (typeof then === 'function') {
          then.call(ret,
                    (val) => {
                      value = val;
                      pt.write(val);
                      if (end) {
                        pt.end();
                      }
                    }, (err) => {
                      pt.destroy(err);
                    },
          );
        } else if (isIterable(ret, true)) {
          finishCount++;
          pump(ret, pt, finish, { end });
        } else {
          throw new ERR_INVALID_RETURN_VALUE(
            'AsyncIterable or Promise', 'destination', ret);
        }

        ret = pt;

        finishCount++;
        destroys.push(destroyer(ret, false, true, finish));
      }
    } else if (isNodeStream(stream)) {
      if (isReadableNodeStream(ret)) {
        ret.pipe(stream, { end });

        // Compat. Before node v10.12.0 stdio used to throw an error so
        // pipe() did/does not end() stdio destinations.
        // Now they allow it but "secretly" don't close the underlying fd.
        if (stream === process.stdout || stream === process.stderr) {
          ret.on('end', () => stream.end());
        }
      } else {
        ret = makeAsyncIterable(ret);

        finishCount++;
        pump(ret, stream, finish, { end });
      }
      ret = stream;
    } else {
      ret = Duplex.from(stream);
    }
  }

  if (signal?.aborted || outerSignal?.aborted) {
    process.nextTick(abort);
  }

  return ret;
}

module.exports = { pipelineImpl, pipeline };
