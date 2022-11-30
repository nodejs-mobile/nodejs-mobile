'use strict';

/* eslint-disable no-use-before-define */

const {
  ArrayBuffer,
  ArrayBufferPrototypeSlice,
  ArrayPrototypePush,
  ArrayPrototypeShift,
  DataView,
  FunctionPrototypeBind,
  FunctionPrototypeCall,
  MathMin,
  NumberIsInteger,
  ObjectCreate,
  ObjectDefineProperties,
  ObjectSetPrototypeOf,
  Promise,
  PromisePrototypeCatch,
  PromisePrototypeThen,
  PromiseResolve,
  PromiseReject,
  PromiseAll,
  ReflectConstruct,
  Symbol,
  SymbolAsyncIterator,
  SymbolToStringTag,
  Uint8Array,
} = primordials;

const {
  codes: {
    ERR_ILLEGAL_CONSTRUCTOR,
    ERR_INVALID_ARG_VALUE,
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_STATE,
    ERR_INVALID_THIS,
  },
} = require('internal/errors');

const {
  DOMException,
} = internalBinding('messaging');

const {
  isArrayBufferView,
  isDataView,
} = require('internal/util/types');

const {
  createDeferredPromise,
  customInspectSymbol: kInspect,
  kEmptyObject,
  kEnumerableProperty,
} = require('internal/util');

const {
  serialize,
  deserialize,
} = require('v8');

const {
  validateObject,
} = require('internal/validators');

const {
  kAborted,
} = require('internal/abort_controller');

const {
  MessageChannel,
} = require('internal/worker/io');

const {
  kDeserialize,
  kTransfer,
  kTransferList,
  makeTransferable,
} = require('internal/worker/js_transferable');

const {
  queueMicrotask,
} = require('internal/process/task_queues');

const {
  kIsDisturbed,
  kIsErrored,
  kIsReadable,
} = require('internal/streams/utils');

const {
  ArrayBufferViewGetBuffer,
  ArrayBufferViewGetByteLength,
  ArrayBufferViewGetByteOffset,
  ArrayBufferGetByteLength,
  AsyncIterator,
  copyArrayBuffer,
  customInspect,
  dequeueValue,
  ensureIsPromise,
  enqueueValueWithSize,
  extractHighWaterMark,
  extractSizeAlgorithm,
  lazyTransfer,
  isBrandCheck,
  resetQueue,
  setPromiseHandled,
  transferArrayBuffer,
  nonOpCancel,
  nonOpPull,
  nonOpStart,
  kType,
  kState,
} = require('internal/webstreams/util');

const {
  WritableStreamDefaultWriter,

  isWritableStream,
  isWritableStreamLocked,
  isWritableStreamDefaultController,
  isWritableStreamDefaultWriter,

  writableStreamAbort,
  writableStreamCloseQueuedOrInFlight,
  writableStreamDefaultWriterCloseWithErrorPropagation,
  writableStreamDefaultWriterRelease,
  writableStreamDefaultWriterWrite,
} = require('internal/webstreams/writablestream');

const assert = require('internal/assert');

const kCancel = Symbol('kCancel');
const kClose = Symbol('kClose');
const kChunk = Symbol('kChunk');
const kError = Symbol('kError');
const kPull = Symbol('kPull');

/**
 * @typedef {import('../abort_controller').AbortSignal} AbortSignal
 * @typedef {import('./queuingstrategies').QueuingStrategy} QueuingStrategy
 * @typedef {import('./queuingstrategies').QueuingStrategySize
 * } QueuingStrategySize
 * @typedef {import('./writablestream').WritableStream} WritableStream
 */

/**
 * @typedef {ReadableStreamDefaultController | ReadableByteStreamController
 * } ReadableStreamController
 */

/**
 * @typedef {ReadableStreamDefaultReader | ReadableStreamBYOBReader
 * } ReadableStreamReader
 */

/**
 * @callback UnderlyingSourceStartCallback
 * @param {ReadableStreamController} controller
 * @returns { any | Promise<void> }
 */

/**
 * @callback UnderlyingSourcePullCallback
 * @param {ReadableStreamController} controller
 * @returns { Promise<void> }
 */

/**
 * @callback UnderlyingSourceCancelCallback
 * @param {any} reason
 * @returns { Promise<void> }
 */

/**
 * @typedef {{
 *   readable: ReadableStream,
 *   writable: WritableStream,
 * }} ReadableWritablePair
 */

/**
 * @typedef {{
 *   preventClose? : boolean,
 *   preventAbort? : boolean,
 *   preventCancel? : boolean,
 *   signal? : AbortSignal,
 * }} StreamPipeOptions
 */

/**
 * @typedef {{
 *   start? : UnderlyingSourceStartCallback,
 *   pull? : UnderlyingSourcePullCallback,
 *   cancel? : UnderlyingSourceCancelCallback,
 *   type? : "bytes",
 *   autoAllocateChunkSize? : number
 * }} UnderlyingSource
 */

class ReadableStream {
  [kType] = 'ReadableStream';

  get [SymbolToStringTag]() { return this[kType]; }

  /**
   * @param {UnderlyingSource} [source]
   * @param {QueuingStrategy} [strategy]
   */
  constructor(source = {}, strategy = kEmptyObject) {
    if (source === null)
      throw new ERR_INVALID_ARG_VALUE('source', 'Object', source);
    this[kState] = {
      disturbed: false,
      state: 'readable',
      storedError: undefined,
      stream: undefined,
      transfer: {
        writable: undefined,
        port1: undefined,
        port2: undefined,
        promise: undefined,
      }
    };

    // The spec requires handling of the strategy first
    // here. Specifically, if getting the size and
    // highWaterMark from the strategy fail, that has
    // to trigger a throw before getting the details
    // from the source. So be sure to keep these in
    // this order.
    const size = strategy?.size;
    const highWaterMark = strategy?.highWaterMark;
    const type = source.type;

    if (`${type}` === 'bytes') {
      if (size !== undefined)
        throw new ERR_INVALID_ARG_VALUE.RangeError('strategy.size', size);
      setupReadableByteStreamControllerFromSource(
        this,
        source,
        extractHighWaterMark(highWaterMark, 0));
      return;
    }

    if (type !== undefined)
      throw new ERR_INVALID_ARG_VALUE('source.type', type);
    setupReadableStreamDefaultControllerFromSource(
      this,
      source,
      extractHighWaterMark(highWaterMark, 1),
      extractSizeAlgorithm(size));

    // eslint-disable-next-line no-constructor-return
    return makeTransferable(this);
  }

  get [kIsDisturbed]() {
    return this[kState].disturbed;
  }

  get [kIsErrored]() {
    return this[kState].state === 'errored';
  }

  get [kIsReadable]() {
    return this[kState].state === 'readable';
  }

  /**
   * @readonly
   * @type {boolean}
   */
  get locked() {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    return isReadableStreamLocked(this);
  }

  /**
   * @param {any} [reason]
   * @returns { Promise<void> }
   */
  cancel(reason = undefined) {
    if (!isReadableStream(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStream'));
    if (isReadableStreamLocked(this)) {
      return PromiseReject(
        new ERR_INVALID_STATE.TypeError('ReadableStream is locked'));
    }
    return readableStreamCancel(this, reason);
  }

  /**
   * @param {{
   *   mode? : "byob"
   * }} [options]
   * @returns {ReadableStreamReader}
   */
  getReader(options = kEmptyObject) {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    validateObject(options, 'options', { nullable: true, allowFunction: true });
    const mode = options?.mode;

    if (mode === undefined)
      return new ReadableStreamDefaultReader(this);

    if (`${mode}` !== 'byob')
      throw new ERR_INVALID_ARG_VALUE('options.mode', mode);
    return new ReadableStreamBYOBReader(this);
  }

  /**
   * @param {ReadableWritablePair} transform
   * @param {StreamPipeOptions} [options]
   * @returns {ReadableStream}
   */
  pipeThrough(transform, options = kEmptyObject) {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    const readable = transform?.readable;
    if (!isReadableStream(readable)) {
      throw new ERR_INVALID_ARG_TYPE(
        'transform.readable',
        'ReadableStream',
        readable);
    }
    const writable = transform?.writable;
    if (!isWritableStream(writable)) {
      throw new ERR_INVALID_ARG_TYPE(
        'transform.writable',
        'WritableStream',
        writable);
    }

    // The web platform tests require that these be handled one at a
    // time and in a specific order. options can be null or undefined.
    const preventAbort = options?.preventAbort;
    const preventCancel = options?.preventCancel;
    const preventClose = options?.preventClose;
    const signal = options?.signal;

    if (signal !== undefined && signal?.[kAborted] === undefined)
      throw new ERR_INVALID_ARG_TYPE('options.signal', 'AbortSignal', signal);

    if (isReadableStreamLocked(this))
      throw new ERR_INVALID_STATE.TypeError('The ReadableStream is locked');
    if (isWritableStreamLocked(writable))
      throw new ERR_INVALID_STATE.TypeError('The WritableStream is locked');

    const promise = readableStreamPipeTo(
      this,
      writable,
      !!preventClose,
      !!preventAbort,
      !!preventCancel,
      signal);
    setPromiseHandled(promise);

    return readable;
  }

  /**
   * @param {WritableStream} destination
   * @param {StreamPipeOptions} [options]
   * @returns {Promise<void>}
   */
  pipeTo(destination, options = kEmptyObject) {
    try {
      if (!isReadableStream(this))
        throw new ERR_INVALID_THIS('ReadableStream');
      if (!isWritableStream(destination)) {
        throw new ERR_INVALID_ARG_TYPE(
          'transform.writable',
          'WritableStream',
          destination);
      }

      const preventAbort = options?.preventAbort;
      const preventCancel = options?.preventCancel;
      const preventClose = options?.preventClose;
      const signal = options?.signal;

      if (signal !== undefined && signal?.[kAborted] === undefined)
        throw new ERR_INVALID_ARG_TYPE('options.signal', 'AbortSignal', signal);

      if (isReadableStreamLocked(this))
        throw new ERR_INVALID_STATE.TypeError('The ReadableStream is locked');
      if (isWritableStreamLocked(destination))
        throw new ERR_INVALID_STATE.TypeError('The WritableStream is locked');

      return readableStreamPipeTo(
        this,
        destination,
        !!preventClose,
        !!preventAbort,
        !!preventCancel,
        signal);
    } catch (error) {
      return PromiseReject(error);
    }
  }

  /**
   * @returns {ReadableStream[]}
   */
  tee() {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    return readableStreamTee(this, false);
  }

  /**
   * @param {{
   *   preventCancel? : boolean,
   * }} [options]
   * @returns {AsyncIterable}
   */
  values(options = kEmptyObject) {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    validateObject(options, 'options');
    const {
      preventCancel = false,
    } = options;

    const reader = new ReadableStreamDefaultReader(this);
    let done = false;
    let started = false;
    let current;

    // The nextSteps function is not an async function in order
    // to make it more efficient. Because nextSteps explicitly
    // creates a Promise and returns it in the common case,
    // making it an async function just causes two additional
    // unnecessary Promise allocations to occur, which just add
    // cost.
    function nextSteps() {
      if (done)
        return PromiseResolve({ done: true, value: undefined });

      if (reader[kState].stream === undefined) {
        return PromiseReject(
          new ERR_INVALID_STATE.TypeError(
            'The reader is not bound to a ReadableStream'));
      }
      const promise = createDeferredPromise();

      readableStreamDefaultReaderRead(reader, {
        [kChunk](chunk) {
          current = undefined;
          promise.resolve({ value: chunk, done: false });
        },
        [kClose]() {
          current = undefined;
          done = true;
          readableStreamReaderGenericRelease(reader);
          promise.resolve({ done: true, value: undefined });
        },
        [kError](error) {
          current = undefined;
          done = true;
          readableStreamReaderGenericRelease(reader);
          promise.reject(error);
        }
      });
      return promise.promise;
    }

    async function returnSteps(value) {
      if (done)
        return { done: true, value };
      done = true;

      if (reader[kState].stream === undefined) {
        throw new ERR_INVALID_STATE.TypeError(
          'The reader is not bound to a ReadableStream');
      }
      assert(!reader[kState].readRequests.length);
      if (!preventCancel) {
        const result = readableStreamReaderGenericCancel(reader, value);
        readableStreamReaderGenericRelease(reader);
        await result;
        return { done: true, value };
      }

      readableStreamReaderGenericRelease(reader);
      return { done: true, value };
    }

    // TODO(@jasnell): Explore whether an async generator
    // can be used here instead of a custom iterator object.
    return ObjectSetPrototypeOf({
      // Changing either of these functions (next or return)
      // to async functions causes a failure in the streams
      // Web Platform Tests that check for use of a modified
      // Promise.prototype.then. Since the await keyword
      // uses Promise.prototype.then, it is open to prototype
      // pollution, which causes the test to fail. The other
      // await uses here do not trigger that failure because
      // the test that fails does not trigger those code paths.
      next() {
        // If this is the first read, delay by one microtask
        // to ensure that the controller has had an opportunity
        // to properly start and perform the initial pull.
        // TODO(@jasnell): The spec doesn't call this out so
        // need to investigate if it's a bug in our impl or
        // the spec.
        if (!started) {
          current = PromiseResolve();
          started = true;
        }
        current = current !== undefined ?
          PromisePrototypeThen(current, nextSteps, nextSteps) :
          nextSteps();
        return current;
      },

      return(error) {
        return current ?
          PromisePrototypeThen(
            current,
            () => returnSteps(error),
            () => returnSteps(error)) :
          returnSteps(error);
      },

      [SymbolAsyncIterator]() { return this; }
    }, AsyncIterator);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], {
      locked: this.locked,
      state: this[kState].state,
      supportsBYOB:
        this[kState].controller instanceof ReadableByteStreamController,
    });
  }

  [kTransfer]() {
    if (!isReadableStream(this))
      throw new ERR_INVALID_THIS('ReadableStream');
    if (this.locked) {
      this[kState].transfer.port1?.close();
      this[kState].transfer.port1 = undefined;
      this[kState].transfer.port2 = undefined;
      throw new DOMException(
        'Cannot transfer a locked ReadableStream',
        'DataCloneError');
    }

    const {
      writable,
      promise,
    } = lazyTransfer().newCrossRealmWritableSink(
      this,
      this[kState].transfer.port1);

    this[kState].transfer.writable = writable;
    this[kState].transfer.promise = promise;

    return {
      data: { port: this[kState].transfer.port2 },
      deserializeInfo:
        'internal/webstreams/readablestream:TransferredReadableStream'
    };
  }

  [kTransferList]() {
    const { port1, port2 } = new MessageChannel();
    this[kState].transfer.port1 = port1;
    this[kState].transfer.port2 = port2;
    return [ port2 ];
  }

  [kDeserialize]({ port }) {
    const transfer = lazyTransfer();
    setupReadableStreamDefaultControllerFromSource(
      this,
      new transfer.CrossRealmTransformReadableSource(port),
      0, () => 1);
  }
}

ObjectDefineProperties(ReadableStream.prototype, {
  [SymbolAsyncIterator]: {
    __proto__: null,
    configurable: true,
    enumerable: false,
    writable: true,
    value: ReadableStream.prototype.values,
  },
  locked: kEnumerableProperty,
  cancel: kEnumerableProperty,
  getReader: kEnumerableProperty,
  pipeThrough: kEnumerableProperty,
  pipeTo: kEnumerableProperty,
  tee: kEnumerableProperty,
});

function TransferredReadableStream() {
  return makeTransferable(ReflectConstruct(
    function() {
      this[kType] = 'ReadableStream';
      this[kState] = {
        disturbed: false,
        state: 'readable',
        storedError: undefined,
        stream: undefined,
        transfer: {
          writable: undefined,
          port: undefined,
          promise: undefined,
        }
      };
    },
    [], ReadableStream));
}
TransferredReadableStream.prototype[kDeserialize] = () => {};

class ReadableStreamBYOBRequest {
  [kType] = 'ReadableStreamBYOBRequest';

  get [SymbolToStringTag]() { return this[kType]; }

  constructor() {
    throw new ERR_ILLEGAL_CONSTRUCTOR();
  }

  /**
   * @readonly
   * @type {ArrayBufferView}
   */
  get view() {
    if (!isReadableStreamBYOBRequest(this))
      throw new ERR_INVALID_THIS('ReadableStreamBYOBRequest');
    return this[kState].view;
  }

  /**
   * @param {number} bytesWritten
   */
  respond(bytesWritten) {
    if (!isReadableStreamBYOBRequest(this))
      throw new ERR_INVALID_THIS('ReadableStreamBYOBRequest');
    const {
      view,
      controller,
    } = this[kState];
    if (controller === undefined) {
      throw new ERR_INVALID_STATE.TypeError(
        'This BYOB request has been invalidated');
    }

    const viewByteLength = ArrayBufferViewGetByteLength(view);
    const viewBuffer = ArrayBufferViewGetBuffer(view);
    const viewBufferByteLength = ArrayBufferGetByteLength(viewBuffer);

    if (viewByteLength === 0 || viewBufferByteLength === 0) {
      throw new ERR_INVALID_STATE.TypeError(
        'View ArrayBuffer is zero-length or detached');
    }

    readableByteStreamControllerRespond(controller, bytesWritten);
  }

  /**
   * @param {ArrayBufferView} view
   */
  respondWithNewView(view) {
    if (!isReadableStreamBYOBRequest(this))
      throw new ERR_INVALID_THIS('ReadableStreamBYOBRequest');
    const {
      controller,
    } = this[kState];

    if (controller === undefined) {
      throw new ERR_INVALID_STATE.TypeError(
        'This BYOB request has been invalidated');
    }

    readableByteStreamControllerRespondWithNewView(controller, view);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], {
      view: this.view,
      controller: this[kState].controller,
    });
  }
}

ObjectDefineProperties(ReadableStreamBYOBRequest.prototype, {
  view: kEnumerableProperty,
  respond: kEnumerableProperty,
  respondWithNewView: kEnumerableProperty,
});

function createReadableStreamBYOBRequest(controller, view) {
  return ReflectConstruct(
    function() {
      this[kType] = 'ReadableStreamBYOBRequest';
      this[kState] = {
        controller,
        view,
      };
    },
    [],
    ReadableStreamBYOBRequest
  );
}

class DefaultReadRequest {
  constructor() {
    this[kState] = createDeferredPromise();
  }

  [kChunk](value) {
    this[kState].resolve?.({ value, done: false });
  }

  [kClose]() {
    this[kState].resolve?.({ value: undefined, done: true });
  }

  [kError](error) {
    this[kState].reject?.(error);
  }

  get promise() { return this[kState].promise; }
}

class ReadIntoRequest {
  constructor() {
    this[kState] = createDeferredPromise();
  }

  [kChunk](value) {
    this[kState].resolve?.({ value, done: false });
  }

  [kClose](value) {
    this[kState].resolve?.({ value, done: true });
  }

  [kError](error) {
    this[kState].reject?.(error);
  }

  get promise() { return this[kState].promise; }
}

class ReadableStreamDefaultReader {
  [kType] = 'ReadableStreamDefaultReader';

  get [SymbolToStringTag]() { return this[kType]; }

  /**
   * @param {ReadableStream} stream
   */
  constructor(stream) {
    if (!isReadableStream(stream))
      throw new ERR_INVALID_ARG_TYPE('stream', 'ReadableStream', stream);
    this[kState] = {
      readRequests: [],
      stream: undefined,
      close: {
        promise: undefined,
        resolve: undefined,
        reject: undefined,
      },
    };
    setupReadableStreamDefaultReader(this, stream);
  }

  /**
   * @returns {Promise<{
   *   value : any,
   *   done : boolean
   * }>}
   */
  read() {
    if (!isReadableStreamDefaultReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamDefaultReader'));
    if (this[kState].stream === undefined) {
      return PromiseReject(
        new ERR_INVALID_STATE.TypeError(
          'The reader is not attached to a stream'));
    }
    const readRequest = new DefaultReadRequest();
    readableStreamDefaultReaderRead(this, readRequest);
    return readRequest.promise;
  }

  releaseLock() {
    if (!isReadableStreamDefaultReader(this))
      throw new ERR_INVALID_THIS('ReadableStreamDefaultReader');
    if (this[kState].stream === undefined)
      return;
    if (this[kState].readRequests.length) {
      throw new ERR_INVALID_STATE.TypeError(
        'Cannot release with pending read requests');
    }
    readableStreamReaderGenericRelease(this);
  }

  /**
   * @readonly
   * @type {Promise<void>}
   */
  get closed() {
    if (!isReadableStreamDefaultReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamDefaultReader'));
    return this[kState].close.promise;
  }

  /**
   * @param {any} reason
   * @returns {Promise<void>}
   */
  cancel(reason = undefined) {
    if (!isReadableStreamDefaultReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamDefaultReader'));
    if (this[kState].stream === undefined) {
      return PromiseReject(new ERR_INVALID_STATE.TypeError(
        'The reader is not attached to a stream'));
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], {
      stream: this[kState].stream,
      readRequests: this[kState].readRequests.length,
      close: this[kState].close.promise,
    });
  }
}

ObjectDefineProperties(ReadableStreamDefaultReader.prototype, {
  closed: kEnumerableProperty,
  read: kEnumerableProperty,
  releaseLock: kEnumerableProperty,
  cancel: kEnumerableProperty,
});

class ReadableStreamBYOBReader {
  [kType] = 'ReadableStreamBYOBReader';

  get [SymbolToStringTag]() { return this[kType]; }

  /**
   * @param {ReadableStream} stream
   */
  constructor(stream) {
    if (!isReadableStream(stream))
      throw new ERR_INVALID_ARG_TYPE('stream', 'ReadableStream', stream);
    this[kState] = {
      stream: undefined,
      requestIntoRequests: [],
      close: {
        promise: undefined,
        resolve: undefined,
        reject: undefined,
      },
    };
    setupReadableStreamBYOBReader(this, stream);
  }

  /**
   * @param {ArrayBufferView} view
   * @returns {Promise<{
   *   view : ArrayBufferView,
   *   done : boolean,
   * }>}
   */
  read(view) {
    if (!isReadableStreamBYOBReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamBYOBReader'));
    if (!isArrayBufferView(view)) {
      return PromiseReject(
        new ERR_INVALID_ARG_TYPE(
          'view',
          [
            'Buffer',
            'TypedArray',
            'DataView',
          ],
          view));
    }
    const viewByteLength = ArrayBufferViewGetByteLength(view);
    const viewBuffer = ArrayBufferViewGetBuffer(view);
    const viewBufferByteLength = ArrayBufferGetByteLength(viewBuffer);

    if (viewByteLength === 0 || viewBufferByteLength === 0) {
      return PromiseReject(
        new ERR_INVALID_STATE.TypeError(
          'View ArrayBuffer is zero-length or detached'));
    }
    // Supposed to assert here that the view's buffer is not
    // detached, but there's no API available to use to check that.
    if (this[kState].stream === undefined) {
      return PromiseReject(
        new ERR_INVALID_STATE.TypeError(
          'The reader is not attached to a stream'));
    }
    const readIntoRequest = new ReadIntoRequest();
    readableStreamBYOBReaderRead(this, view, readIntoRequest);
    return readIntoRequest.promise;
  }

  releaseLock() {
    if (!isReadableStreamBYOBReader(this))
      throw new ERR_INVALID_THIS('ReadableStreamBYOBReader');
    if (this[kState].stream === undefined)
      return;
    if (this[kState].readIntoRequests.length) {
      throw new ERR_INVALID_STATE.TypeError(
        'Cannot release with pending read requests');
    }
    readableStreamReaderGenericRelease(this);
  }

  /**
   * @readonly
   * @type {Promise<void>}
   */
  get closed() {
    if (!isReadableStreamBYOBReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamBYOBReader'));
    return this[kState].close.promise;
  }

  /**
   * @param {any} reason
   * @returns {Promise<void>}
   */
  cancel(reason = undefined) {
    if (!isReadableStreamBYOBReader(this))
      return PromiseReject(new ERR_INVALID_THIS('ReadableStreamBYOBReader'));
    if (this[kState].stream === undefined) {
      return PromiseReject(new ERR_INVALID_STATE.TypeError(
        'The reader is not attached to a stream'));
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], {
      stream: this[kState].stream,
      requestIntoRequests: this[kState].requestIntoRequests.length,
      close: this[kState].close.promise,
    });
  }
}

ObjectDefineProperties(ReadableStreamBYOBReader.prototype, {
  closed: kEnumerableProperty,
  read: kEnumerableProperty,
  releaseLock: kEnumerableProperty,
  cancel: kEnumerableProperty,
});

class ReadableStreamDefaultController {
  [kType] = 'ReadableStreamDefaultController';

  get [SymbolToStringTag]() { return this[kType]; }

  constructor() {
    throw new ERR_ILLEGAL_CONSTRUCTOR();
  }

  /**
   * @readonly
   * @type {number}
   */
  get desiredSize() {
    return readableStreamDefaultControllerGetDesiredSize(this);
  }

  close() {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this))
      throw new ERR_INVALID_STATE.TypeError('Controller is already closed');
    readableStreamDefaultControllerClose(this);
  }

  /**
   * @param {any} chunk
   */
  enqueue(chunk = undefined) {
    if (!readableStreamDefaultControllerCanCloseOrEnqueue(this))
      throw new ERR_INVALID_STATE.TypeError('Controller is already closed');
    readableStreamDefaultControllerEnqueue(this, chunk);
  }

  /**
   * @param {any} error
   */
  error(error = undefined) {
    readableStreamDefaultControllerError(this, error);
  }

  [kCancel](reason) {
    return readableStreamDefaultControllerCancelSteps(this, reason);
  }

  [kPull](readRequest) {
    readableStreamDefaultControllerPullSteps(this, readRequest);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], { });
  }
}

ObjectDefineProperties(ReadableStreamDefaultController.prototype, {
  desiredSize: kEnumerableProperty,
  close: kEnumerableProperty,
  enqueue: kEnumerableProperty,
  error: kEnumerableProperty,
});

function createReadableStreamDefaultController() {
  return ReflectConstruct(
    function() {
      this[kType] = 'ReadableStreamDefaultController';
      this[kState] = {};
    },
    [],
    ReadableStreamDefaultController,
  );
}

class ReadableByteStreamController {
  [kType] = 'ReadableByteStreamController';

  get [SymbolToStringTag]() { return this[kType]; }

  constructor() {
    throw new ERR_ILLEGAL_CONSTRUCTOR();
  }

  /**
   * @readonly
   * @type {ReadableStreamBYOBRequest}
   */
  get byobRequest() {
    if (!isReadableByteStreamController(this))
      throw new ERR_INVALID_THIS('ReadableByteStreamController');
    if (this[kState].byobRequest === null &&
        this[kState].pendingPullIntos.length) {
      const {
        buffer,
        byteOffset,
        bytesFilled,
        byteLength,
      } = this[kState].pendingPullIntos[0];
      const view =
        new Uint8Array(
          buffer,
          byteOffset + bytesFilled,
          byteLength - bytesFilled);
      this[kState].byobRequest = createReadableStreamBYOBRequest(this, view);
    }
    return this[kState].byobRequest;
  }

  /**
   * @readonly
   * @type {number}
   */
  get desiredSize() {
    if (!isReadableByteStreamController(this))
      throw new ERR_INVALID_THIS('ReadableByteStreamController');
    return readableByteStreamControllerGetDesiredSize(this);
  }

  close() {
    if (!isReadableByteStreamController(this))
      throw new ERR_INVALID_THIS('ReadableByteStreamController');
    if (this[kState].closeRequested)
      throw new ERR_INVALID_STATE.TypeError('Controller is already closed');
    if (this[kState].stream[kState].state !== 'readable')
      throw new ERR_INVALID_STATE.TypeError('ReadableStream is already closed');
    readableByteStreamControllerClose(this);
  }

  /**
   * @param {ArrayBufferView} chunk
   */
  enqueue(chunk) {
    if (!isReadableByteStreamController(this))
      throw new ERR_INVALID_THIS('ReadableByteStreamController');
    if (!isArrayBufferView(chunk)) {
      throw new ERR_INVALID_ARG_TYPE(
        'chunk',
        [
          'Buffer',
          'TypedArray',
          'DataView',
        ],
        chunk);
    }
    const chunkByteLength = ArrayBufferViewGetByteLength(chunk);
    const chunkByteOffset = ArrayBufferViewGetByteOffset(chunk);
    const chunkBuffer = ArrayBufferViewGetBuffer(chunk);
    const chunkBufferByteLength = ArrayBufferGetByteLength(chunkBuffer);
    if (chunkByteLength === 0 || chunkBufferByteLength === 0) {
      throw new ERR_INVALID_STATE.TypeError(
        'chunk ArrayBuffer is zero-length or detached');
    }
    if (this[kState].closeRequested)
      throw new ERR_INVALID_STATE.TypeError('Controller is already closed');
    if (this[kState].stream[kState].state !== 'readable')
      throw new ERR_INVALID_STATE.TypeError('ReadableStream is already closed');
    readableByteStreamControllerEnqueue(
      this,
      chunkBuffer,
      chunkByteLength,
      chunkByteOffset);
  }

  /**
   * @param {any} error
   */
  error(error = undefined) {
    if (!isReadableByteStreamController(this))
      throw new ERR_INVALID_THIS('ReadableByteStreamController');
    readableByteStreamControllerError(this, error);
  }

  [kCancel](reason) {
    return readableByteStreamControllerCancelSteps(this, reason);
  }

  [kPull](readRequest) {
    readableByteStreamControllerPullSteps(this, readRequest);
  }

  [kInspect](depth, options) {
    return customInspect(depth, options, this[kType], { });
  }
}

ObjectDefineProperties(ReadableByteStreamController.prototype, {
  byobRequest: kEnumerableProperty,
  desiredSize: kEnumerableProperty,
  close: kEnumerableProperty,
  enqueue: kEnumerableProperty,
  error: kEnumerableProperty,
});

function createReadableByteStreamController() {
  return ReflectConstruct(
    function() {
      this[kType] = 'ReadableByteStreamController';
      this[kState] = {};
    },
    [],
    ReadableByteStreamController,
  );
}

function createTeeReadableStream(start, pull, cancel) {
  return ReflectConstruct(
    function() {
      this[kType] = 'ReadableStream';
      this[kState] = {
        disturbed: false,
        state: 'readable',
        storedError: undefined,
        stream: undefined,
        transfer: {
          writable: undefined,
          port: undefined,
          promise: undefined,
        }
      };
      setupReadableStreamDefaultControllerFromSource(
        this,
        ObjectCreate(null, {
          start: { __proto__: null, value: start },
          pull: { __proto__: null, value: pull },
          cancel: { __proto__: null, value: cancel }
        }),
        1,
        () => 1);
      return makeTransferable(this);
    }, [], ReadableStream,
  );
}

const isReadableStream =
  isBrandCheck('ReadableStream');
const isReadableByteStreamController =
  isBrandCheck('ReadableByteStreamController');
const isReadableStreamBYOBRequest =
  isBrandCheck('ReadableStreamBYOBRequest');
const isReadableStreamDefaultReader =
  isBrandCheck('ReadableStreamDefaultReader');
const isReadableStreamBYOBReader =
  isBrandCheck('ReadableStreamBYOBReader');

// ---- ReadableStream Implementation

function readableStreamPipeTo(
  source,
  dest,
  preventClose,
  preventAbort,
  preventCancel,
  signal) {

  let reader;
  let writer;
  // Both of these can throw synchronously. We want to capture
  // the error and return a rejected promise instead.
  try {
    reader = new ReadableStreamDefaultReader(source);
    writer = new WritableStreamDefaultWriter(dest);
  } catch (error) {
    return PromiseReject(error);
  }

  source[kState].disturbed = true;

  let shuttingDown = false;

  if (signal !== undefined && signal?.[kAborted] === undefined) {
    return PromiseReject(
      new ERR_INVALID_ARG_TYPE(
        'options.signal',
        'AbortSignal',
        signal));
  }

  const promise = createDeferredPromise();

  let currentWrite = PromiseResolve();

  // The error here can be undefined. The rejected arg
  // tells us that the promise must be rejected even
  // when error is undefine.
  function finalize(rejected, error) {
    writableStreamDefaultWriterRelease(writer);
    readableStreamReaderGenericRelease(reader);
    if (signal !== undefined)
      signal.removeEventListener('abort', abortAlgorithm);
    if (rejected)
      promise.reject(error);
    else
      promise.resolve();
  }

  async function waitForCurrentWrite() {
    const write = currentWrite;
    await write;
    if (write !== currentWrite)
      await waitForCurrentWrite();
  }

  function shutdownWithAnAction(action, rejected, originalError) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (dest[kState].state === 'writable' &&
        !writableStreamCloseQueuedOrInFlight(dest)) {
      PromisePrototypeThen(
        waitForCurrentWrite(),
        complete,
        (error) => finalize(true, error));
      return;
    }
    complete();

    function complete() {
      PromisePrototypeThen(
        action(),
        () => finalize(rejected, originalError),
        (error) => finalize(true, error));
    }
  }

  function shutdown(rejected, error) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (dest[kState].state === 'writable' &&
        !writableStreamCloseQueuedOrInFlight(dest)) {
      PromisePrototypeThen(
        waitForCurrentWrite(),
        () => finalize(rejected, error),
        (error) => finalize(true, error));
      return;
    }
    finalize(rejected, error);
  }

  function abortAlgorithm() {
    // Cannot use the AbortError class here. It must be a DOMException
    const error = new DOMException('The operation was aborted', 'AbortError');
    const actions = [];
    if (!preventAbort) {
      ArrayPrototypePush(
        actions,
        () => {
          if (dest[kState].state === 'writable')
            return writableStreamAbort(dest, error);
          return PromiseResolve();
        });
    }
    if (!preventCancel) {
      ArrayPrototypePush(
        actions,
        () => {
          if (source[kState].state === 'readable')
            return readableStreamCancel(source, error);
          return PromiseResolve();
        });
    }

    shutdownWithAnAction(
      async () => PromiseAll(actions.map((action) => action())),
      true,
      error);
  }

  function watchErrored(stream, promise, action) {
    if (stream[kState].state === 'errored')
      action(stream[kState].storedError);
    else
      PromisePrototypeCatch(promise, action);
  }

  function watchClosed(stream, promise, action) {
    if (stream[kState].state === 'closed')
      action();
    else
      PromisePrototypeThen(promise, action, () => {});
  }

  async function step() {
    if (shuttingDown)
      return true;
    await writer[kState].ready.promise;
    return new Promise((resolve, reject) => {
      readableStreamDefaultReaderRead(
        reader,
        {
          [kChunk](chunk) {
            currentWrite = writableStreamDefaultWriterWrite(writer, chunk);
            setPromiseHandled(currentWrite);
            resolve(false);
          },
          [kClose]: () => resolve(true),
          [kError]: reject,
        });
    });
  }

  async function run() {
    // Run until step resolves as true
    while (!await step());
  }

  if (signal !== undefined) {
    if (signal.aborted) {
      abortAlgorithm();
      return promise.promise;
    }
    signal.addEventListener('abort', abortAlgorithm, { once: true });
  }

  setPromiseHandled(run());

  watchErrored(source, reader[kState].close.promise, (error) => {
    if (!preventAbort) {
      return shutdownWithAnAction(
        () => writableStreamAbort(dest, error),
        true,
        error);
    }
    shutdown(true, error);
  });

  watchErrored(dest, writer[kState].close.promise, (error) => {
    if (!preventCancel) {
      return shutdownWithAnAction(
        () => readableStreamCancel(source, error),
        true,
        error);
    }
    shutdown(true, error);
  });

  watchClosed(source, reader[kState].close.promise, () => {
    if (!preventClose) {
      return shutdownWithAnAction(
        () => writableStreamDefaultWriterCloseWithErrorPropagation(writer));
    }
    shutdown();
  });

  if (writableStreamCloseQueuedOrInFlight(dest) ||
      dest[kState].state === 'closed') {
    const error = new ERR_INVALID_STATE.TypeError(
      'Destination WritableStream is closed');
    if (!preventCancel) {
      shutdownWithAnAction(
        () => readableStreamCancel(source, error), true, error);
    } else {
      shutdown(true, error);
    }
  }

  return promise.promise;
}

function readableStreamTee(stream, cloneForBranch2) {
  const reader = new ReadableStreamDefaultReader(stream);
  let reading = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1;
  let reason2;
  let branch1;
  let branch2;
  const cancelPromise = createDeferredPromise();

  async function pullAlgorithm() {
    if (reading) return;
    reading = true;
    const readRequest = {
      [kChunk](value) {
        queueMicrotask(() => {
          reading = false;
          const value1 = value;
          let value2 = value;
          if (!canceled2 && cloneForBranch2) {
            // Structured Clone
            value2 = deserialize(serialize(value2));
          }
          if (!canceled1) {
            readableStreamDefaultControllerEnqueue(
              branch1[kState].controller,
              value1);
          }
          if (!canceled2) {
            readableStreamDefaultControllerEnqueue(
              branch2[kState].controller,
              value2);
          }
        });
      },
      [kClose]() {
        // The `process.nextTick()` is not part of the spec.
        // This approach was needed to avoid a race condition working with esm
        // Further information, see: https://github.com/nodejs/node/issues/39758
        process.nextTick(() => {
          reading = false;
          if (!canceled1)
            readableStreamDefaultControllerClose(branch1[kState].controller);
          if (!canceled2)
            readableStreamDefaultControllerClose(branch2[kState].controller);
          if (!canceled1 || !canceled2)
            cancelPromise.resolve();
        });
      },
      [kError]() {
        reading = false;
      },
    };
    readableStreamDefaultReaderRead(reader, readRequest);
  }

  function cancel1Algorithm(reason) {
    canceled1 = true;
    reason1 = reason;
    if (canceled2) {
      const compositeReason = [reason1, reason2];
      cancelPromise.resolve(readableStreamCancel(stream, compositeReason));
    }
    return cancelPromise.promise;
  }

  function cancel2Algorithm(reason) {
    canceled2 = true;
    reason2 = reason;
    if (canceled1) {
      const compositeReason = [reason1, reason2];
      cancelPromise.resolve(readableStreamCancel(stream, compositeReason));
    }
    return cancelPromise.promise;
  }

  branch1 =
    createTeeReadableStream(nonOpStart, pullAlgorithm, cancel1Algorithm);
  branch2 =
    createTeeReadableStream(nonOpStart, pullAlgorithm, cancel2Algorithm);

  PromisePrototypeCatch(
    reader[kState].close.promise,
    (error) => {
      readableStreamDefaultControllerError(branch1[kState].controller, error);
      readableStreamDefaultControllerError(branch2[kState].controller, error);
      if (!canceled1 || !canceled2)
        cancelPromise.resolve();
    });

  return [branch1, branch2];
}

function readableByteStreamControllerConvertPullIntoDescriptor(desc) {
  const {
    buffer,
    bytesFilled,
    byteLength,
    byteOffset,
    ctor,
    elementSize,
  } = desc;
  if (bytesFilled > byteLength)
    throw new ERR_INVALID_STATE.RangeError('The buffer size is invalid');
  assert(!(bytesFilled % elementSize));
  const transferredBuffer = transferArrayBuffer(buffer);
  return new ctor(transferredBuffer, byteOffset, bytesFilled / elementSize);
}

function isReadableStreamLocked(stream) {
  return stream[kState].reader !== undefined;
}

function readableStreamCancel(stream, reason) {
  stream[kState].disturbed = true;
  switch (stream[kState].state) {
    case 'closed':
      return PromiseResolve();
    case 'errored':
      return PromiseReject(stream[kState].storedError);
  }
  readableStreamClose(stream);
  const {
    reader,
  } = stream[kState];
  if (reader !== undefined && readableStreamHasBYOBReader(stream)) {
    for (let n = 0; n < reader[kState].readIntoRequests.length; n++)
      reader[kState].readIntoRequests[n][kClose]();
    reader[kState].readIntoRequests = [];
  }

  return PromisePrototypeThen(
    ensureIsPromise(
      stream[kState].controller[kCancel],
      stream[kState].controller,
      reason),
    () => {});
}

function readableStreamClose(stream) {
  assert(stream[kState].state === 'readable');
  stream[kState].state = 'closed';

  const {
    reader,
  } = stream[kState];

  if (reader === undefined)
    return;

  reader[kState].close.resolve();

  if (readableStreamHasDefaultReader(stream)) {
    for (let n = 0; n < reader[kState].readRequests.length; n++)
      reader[kState].readRequests[n][kClose]();
    reader[kState].readRequests = [];
  }
}

function readableStreamError(stream, error) {
  assert(stream[kState].state === 'readable');
  stream[kState].state = 'errored';
  stream[kState].storedError = error;

  const {
    reader
  } = stream[kState];

  if (reader === undefined)
    return;

  reader[kState].close.reject(error);
  setPromiseHandled(reader[kState].close.promise);

  if (readableStreamHasDefaultReader(stream)) {
    for (let n = 0; n < reader[kState].readRequests.length; n++)
      reader[kState].readRequests[n][kError](error);
    reader[kState].readRequests = [];
  } else {
    assert(readableStreamHasBYOBReader(stream));
    for (let n = 0; n < reader[kState].readIntoRequests.length; n++)
      reader[kState].readIntoRequests[n][kError](error);
    reader[kState].readIntoRequests = [];
  }
}

function readableStreamHasDefaultReader(stream) {
  const {
    reader,
  } = stream[kState];

  if (reader === undefined)
    return false;

  return reader[kState] !== undefined &&
         reader[kType] === 'ReadableStreamDefaultReader';
}

function readableStreamGetNumReadRequests(stream) {
  assert(readableStreamHasDefaultReader(stream));
  return stream[kState].reader[kState].readRequests.length;
}

function readableStreamHasBYOBReader(stream) {
  const {
    reader,
  } = stream[kState];

  if (reader === undefined)
    return false;

  return reader[kState] !== undefined &&
         reader[kType] === 'ReadableStreamBYOBReader';
}

function readableStreamGetNumReadIntoRequests(stream) {
  assert(readableStreamHasBYOBReader(stream));
  return stream[kState].reader[kState].readIntoRequests.length;
}

function readableStreamFulfillReadRequest(stream, chunk, done) {
  assert(readableStreamHasDefaultReader(stream));
  const {
    reader,
  } = stream[kState];
  assert(reader[kState].readRequests.length);
  const readRequest = ArrayPrototypeShift(reader[kState].readRequests);

  // TODO(@jasnell): It's not clear under what exact conditions done
  // will be true here. The spec requires this check but none of the
  // WPT's or other tests trigger it. Will need to investigate how to
  // get coverage for this.
  if (done)
    readRequest[kClose]();
  else
    readRequest[kChunk](chunk);
}

function readableStreamFulfillReadIntoRequest(stream, chunk, done) {
  assert(readableStreamHasBYOBReader(stream));
  const {
    reader,
  } = stream[kState];
  assert(reader[kState].readIntoRequests.length);
  const readIntoRequest = ArrayPrototypeShift(reader[kState].readIntoRequests);
  if (done)
    readIntoRequest[kClose](chunk);
  else
    readIntoRequest[kChunk](chunk);
}

function readableStreamAddReadRequest(stream, readRequest) {
  assert(readableStreamHasDefaultReader(stream));
  assert(stream[kState].state === 'readable');
  ArrayPrototypePush(stream[kState].reader[kState].readRequests, readRequest);
}

function readableStreamAddReadIntoRequest(stream, readIntoRequest) {
  assert(readableStreamHasBYOBReader(stream));
  assert(stream[kState].state !== 'errored');
  ArrayPrototypePush(
    stream[kState].reader[kState].readIntoRequests,
    readIntoRequest);
}

function readableStreamReaderGenericCancel(reader, reason) {
  const {
    stream,
  } = reader[kState];
  assert(stream !== undefined);
  return readableStreamCancel(stream, reason);
}

function readableStreamReaderGenericInitialize(reader, stream) {
  reader[kState].stream = stream;
  stream[kState].reader = reader;
  switch (stream[kState].state) {
    case 'readable':
      reader[kState].close = createDeferredPromise();
      break;
    case 'closed':
      reader[kState].close = {
        promise: PromiseResolve(),
        resolve: undefined,
        reject: undefined,
      };
      break;
    case 'errored':
      reader[kState].close = {
        promise: PromiseReject(stream[kState].storedError),
        resolve: undefined,
        reject: undefined,
      };
      setPromiseHandled(reader[kState].close.promise);
      break;
  }
}

function readableStreamReaderGenericRelease(reader) {
  const {
    stream,
  } = reader[kState];
  assert(stream !== undefined);
  assert(stream[kState].reader === reader);

  if (stream[kState].state === 'readable') {
    reader[kState].close.reject?.(
      new ERR_INVALID_STATE.TypeError('Reader released'));
  } else {
    reader[kState].close = {
      promise: PromiseReject(
        new ERR_INVALID_STATE.TypeError('Reader released')),
      resolve: undefined,
      reject: undefined,
    };
  }
  setPromiseHandled(reader[kState].close.promise);
  stream[kState].reader = undefined;
  reader[kState].stream = undefined;
}

function readableStreamBYOBReaderRead(reader, view, readIntoRequest) {
  const {
    stream,
  } = reader[kState];
  assert(stream !== undefined);
  stream[kState].disturbed = true;
  if (stream[kState].state === 'errored') {
    readIntoRequest[kError](stream[kState].storedError);
    return;
  }
  readableByteStreamControllerPullInto(
    stream[kState].controller,
    view,
    readIntoRequest);
}

function readableStreamDefaultReaderRead(reader, readRequest) {
  const {
    stream,
  } = reader[kState];
  assert(stream !== undefined);
  stream[kState].disturbed = true;
  switch (stream[kState].state) {
    case 'closed':
      readRequest[kClose]();
      break;
    case 'errored':
      readRequest[kError](stream[kState].storedError);
      break;
    case 'readable':
      stream[kState].controller[kPull](readRequest);
  }
}

function setupReadableStreamBYOBReader(reader, stream) {
  if (isReadableStreamLocked(stream))
    throw new ERR_INVALID_STATE.TypeError('ReadableStream is locked');
  const {
    controller,
  } = stream[kState];
  if (!isReadableByteStreamController(controller))
    throw new ERR_INVALID_ARG_VALUE('stream', stream, 'must be a byte stream');
  readableStreamReaderGenericInitialize(reader, stream);
  reader[kState].readIntoRequests = [];
}

function setupReadableStreamDefaultReader(reader, stream) {
  if (isReadableStreamLocked(stream))
    throw new ERR_INVALID_STATE.TypeError('ReadableStream is locked');
  readableStreamReaderGenericInitialize(reader, stream);
  reader[kState].readRequests = [];
}

function readableStreamDefaultControllerClose(controller) {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
    return;
  controller[kState].closeRequested = true;
  if (!controller[kState].queue.length) {
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamClose(controller[kState].stream);
  }
}

function readableStreamDefaultControllerEnqueue(controller, chunk) {
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller))
    return;

  const {
    stream,
  } = controller[kState];

  if (isReadableStreamLocked(stream) &&
      readableStreamGetNumReadRequests(stream)) {
    readableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    try {
      const chunkSize =
        FunctionPrototypeCall(
          controller[kState].sizeAlgorithm,
          undefined,
          chunk);
      enqueueValueWithSize(controller, chunk, chunkSize);
    } catch (error) {
      readableStreamDefaultControllerError(controller, error);
      throw error;
    }
  }
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

function readableStreamDefaultControllerHasBackpressure(controller) {
  return !readableStreamDefaultControllerShouldCallPull(controller);
}

function readableStreamDefaultControllerCanCloseOrEnqueue(controller) {
  const {
    stream,
  } = controller[kState];
  return !controller[kState].closeRequested &&
         stream[kState].state === 'readable';
}

function readableStreamDefaultControllerGetDesiredSize(controller) {
  const {
    stream,
    highWaterMark,
    queueTotalSize,
  } = controller[kState];
  switch (stream[kState].state) {
    case 'errored': return null;
    case 'closed': return 0;
    default:
      return highWaterMark - queueTotalSize;
  }
}

function readableStreamDefaultControllerShouldCallPull(controller) {
  const {
    stream,
  } = controller[kState];
  if (!readableStreamDefaultControllerCanCloseOrEnqueue(controller) ||
      !controller[kState].started)
    return false;

  if (isReadableStreamLocked(stream) &&
      readableStreamGetNumReadRequests(stream)) {
    return true;
  }

  const desiredSize = readableStreamDefaultControllerGetDesiredSize(controller);
  assert(desiredSize !== null);

  return desiredSize > 0;
}

function readableStreamDefaultControllerCallPullIfNeeded(controller) {
  if (!readableStreamDefaultControllerShouldCallPull(controller))
    return;
  if (controller[kState].pulling) {
    controller[kState].pullAgain = true;
    return;
  }
  assert(!controller[kState].pullAgain);
  controller[kState].pulling = true;
  PromisePrototypeThen(
    ensureIsPromise(controller[kState].pullAlgorithm, controller),
    () => {
      controller[kState].pulling = false;
      if (controller[kState].pullAgain) {
        controller[kState].pullAgain = false;
        readableStreamDefaultControllerCallPullIfNeeded(controller);
      }
    },
    (error) => readableStreamDefaultControllerError(controller, error));
}

function readableStreamDefaultControllerClearAlgorithms(controller) {
  controller[kState].pullAlgorithm = undefined;
  controller[kState].cancelAlgorithm = undefined;
  controller[kState].sizeAlgorithm = undefined;
}

function readableStreamDefaultControllerError(controller, error) {
  const {
    stream,
  } = controller[kState];
  if (stream[kState].state === 'readable') {
    resetQueue(controller);
    readableStreamDefaultControllerClearAlgorithms(controller);
    readableStreamError(stream, error);
  }
}

function readableStreamDefaultControllerCancelSteps(controller, reason) {
  resetQueue(controller);
  try {
    const result = controller[kState].cancelAlgorithm(reason);
    return result;
  } finally {
    readableStreamDefaultControllerClearAlgorithms(controller);
  }
}

function readableStreamDefaultControllerPullSteps(controller, readRequest) {
  const {
    stream,
    queue,
  } = controller[kState];
  if (queue.length) {
    const chunk = dequeueValue(controller);
    if (controller[kState].closeRequested && !queue.length) {
      readableStreamDefaultControllerClearAlgorithms(controller);
      readableStreamClose(stream);
    } else {
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    }
    readRequest[kChunk](chunk);
    return;
  }
  readableStreamAddReadRequest(stream, readRequest);
  readableStreamDefaultControllerCallPullIfNeeded(controller);
}

function setupReadableStreamDefaultController(
  stream,
  controller,
  startAlgorithm,
  pullAlgorithm,
  cancelAlgorithm,
  highWaterMark,
  sizeAlgorithm) {
  assert(stream[kState].controller === undefined);
  controller[kState] = {
    cancelAlgorithm,
    closeRequested: false,
    highWaterMark,
    pullAgain: false,
    pullAlgorithm,
    pulling: false,
    queue: [],
    queueTotalSize: 0,
    started: false,
    sizeAlgorithm,
    stream,
  };
  stream[kState].controller = controller;

  const startResult = startAlgorithm();

  PromisePrototypeThen(
    PromiseResolve(startResult),
    () => {
      controller[kState].started = true;
      assert(!controller[kState].pulling);
      assert(!controller[kState].pullAgain);
      readableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    (error) => readableStreamDefaultControllerError(controller, error));
}

function setupReadableStreamDefaultControllerFromSource(
  stream,
  source,
  highWaterMark,
  sizeAlgorithm) {
  const controller = createReadableStreamDefaultController();
  const start = source?.start;
  const pull = source?.pull;
  const cancel = source?.cancel;
  const startAlgorithm = start ?
    FunctionPrototypeBind(start, source, controller) :
    nonOpStart;
  const pullAlgorithm = pull ?
    FunctionPrototypeBind(pull, source, controller) :
    nonOpPull;

  const cancelAlgorithm = cancel ?
    FunctionPrototypeBind(cancel, source) :
    nonOpCancel;

  setupReadableStreamDefaultController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    sizeAlgorithm);
}

function readableByteStreamControllerClose(controller) {
  const {
    closeRequested,
    pendingPullIntos,
    queueTotalSize,
    stream,
  } = controller[kState];

  if (closeRequested || stream[kState].state !== 'readable')
    return;

  if (queueTotalSize) {
    controller[kState].closeRequested = true;
    return;
  }

  if (pendingPullIntos.length) {
    const firstPendingPullInto = pendingPullIntos[0];
    if (firstPendingPullInto.bytesFilled > 0) {
      const error = new ERR_INVALID_STATE.TypeError('Partial read');
      readableByteStreamControllerError(controller, error);
      throw error;
    }
  }

  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamClose(stream);
}

function readableByteStreamControllerCommitPullIntoDescriptor(stream, desc) {
  assert(stream[kState].state !== 'errored');
  let done = false;
  if (stream[kState].state === 'closed') {
    desc.bytesFilled = 0;
    done = true;
  }

  const filledView =
    readableByteStreamControllerConvertPullIntoDescriptor(desc);

  if (desc.type === 'default') {
    readableStreamFulfillReadRequest(stream, filledView, done);
  } else {
    assert(desc.type === 'byob');
    readableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

function readableByteStreamControllerInvalidateBYOBRequest(controller) {
  if (controller[kState].byobRequest === null)
    return;
  controller[kState].byobRequest[kState].controller = undefined;
  controller[kState].byobRequest[kState].view = null;
  controller[kState].byobRequest = null;
}

function readableByteStreamControllerClearAlgorithms(controller) {
  controller[kState].pullAlgorithm = undefined;
  controller[kState].cancelAlgorithm = undefined;
}

function readableByteStreamControllerClearPendingPullIntos(controller) {
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  controller[kState].pendingPullIntos = [];
}

function readableByteStreamControllerGetDesiredSize(controller) {
  const {
    stream,
    highWaterMark,
    queueTotalSize,
  } = controller[kState];
  switch (stream[kState].state) {
    case 'errored': return null;
    case 'closed': return 0;
    default: return highWaterMark - queueTotalSize;
  }
}

function readableByteStreamControllerShouldCallPull(controller) {
  const {
    stream,
  } = controller[kState];
  if (stream[kState].state !== 'readable' ||
      controller[kState].closeRequested ||
      !controller[kState].started) {
    return false;
  }
  if (readableStreamHasDefaultReader(stream) &&
      readableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }

  if (readableStreamHasBYOBReader(stream) &&
      readableStreamGetNumReadIntoRequests(stream) > 0) {
    return true;
  }

  const desiredSize = readableByteStreamControllerGetDesiredSize(controller);
  assert(desiredSize !== null);

  return desiredSize > 0;
}

function readableByteStreamControllerHandleQueueDrain(controller) {
  const {
    closeRequested,
    queueTotalSize,
    stream,
  } = controller[kState];
  assert(stream[kState].state === 'readable');
  if (!queueTotalSize && closeRequested) {
    readableByteStreamControllerClearAlgorithms(controller);
    readableStreamClose(stream);
    return;
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerPullInto(
  controller,
  view,
  readIntoRequest) {
  const {
    closeRequested,
    stream,
    pendingPullIntos,
  } = controller[kState];
  let elementSize = 1;
  let ctor = DataView;
  if (isArrayBufferView(view) && !isDataView(view)) {
    elementSize = view.constructor.BYTES_PER_ELEMENT;
    ctor = view.constructor;
  }
  const buffer = ArrayBufferViewGetBuffer(view);
  const byteOffset = ArrayBufferViewGetByteOffset(view);
  const byteLength = ArrayBufferViewGetByteLength(view);
  const bufferByteLength = ArrayBufferGetByteLength(buffer);

  let transferredBuffer;
  try {
    transferredBuffer = transferArrayBuffer(buffer);
  } catch (error) {
    readIntoRequest[kError](error);
    return;
  }
  const desc = {
    buffer: transferredBuffer,
    bufferByteLength,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    elementSize,
    ctor,
    type: 'byob',
  };
  if (pendingPullIntos.length) {
    ArrayPrototypePush(pendingPullIntos, desc);
    readableStreamAddReadIntoRequest(stream, readIntoRequest);
    return;
  }
  if (stream[kState].state === 'closed') {
    const emptyView = new ctor(desc.buffer, byteOffset, 0);
    readIntoRequest[kClose](emptyView);
    return;
  }
  if (controller[kState].queueTotalSize) {
    if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(
      controller,
      desc)) {
      const filledView =
        readableByteStreamControllerConvertPullIntoDescriptor(desc);
      readableByteStreamControllerHandleQueueDrain(controller);
      readIntoRequest[kChunk](filledView);
      return;
    }
    if (closeRequested) {
      const error = new ERR_INVALID_STATE.TypeError('ReadableStream closed');
      readableByteStreamControllerError(controller, error);
      readIntoRequest[kError](error);
      return;
    }
  }
  ArrayPrototypePush(pendingPullIntos, desc);
  readableStreamAddReadIntoRequest(stream, readIntoRequest);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerRespondInternal(controller, bytesWritten) {
  const {
    stream,
    pendingPullIntos,
  } = controller[kState];
  const desc = pendingPullIntos[0];
  readableByteStreamControllerInvalidateBYOBRequest(controller);
  if (stream[kState].state === 'closed') {
    if (bytesWritten)
      throw new ERR_INVALID_STATE.TypeError(
        'Controller is closed but view is not zero-length');
    readableByteStreamControllerRespondInClosedState(controller, desc);
  } else {
    assert(stream[kState].state === 'readable');
    if (!bytesWritten)
      throw new ERR_INVALID_STATE.TypeError('View cannot be zero-length');
    readableByteStreamControllerRespondInReadableState(
      controller,
      bytesWritten,
      desc);
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerRespond(controller, bytesWritten) {
  const {
    pendingPullIntos,
    stream,
  } = controller[kState];
  assert(pendingPullIntos.length);
  const desc = pendingPullIntos[0];

  if (stream[kState].state === 'closed') {
    if (bytesWritten !== 0)
      throw new ERR_INVALID_ARG_VALUE('bytesWritten', bytesWritten);
  } else {
    assert(stream[kState].state === 'readable');

    if (!bytesWritten)
      throw new ERR_INVALID_ARG_VALUE('bytesWritten', bytesWritten);

    if ((desc.bytesFilled + bytesWritten) > desc.byteLength)
      throw new ERR_INVALID_ARG_VALUE.RangeError('bytesWritten', bytesWritten);
  }

  desc.buffer = transferArrayBuffer(desc.buffer);

  readableByteStreamControllerRespondInternal(controller, bytesWritten);
}

function readableByteStreamControllerRespondInClosedState(controller, desc) {
  assert(!desc.bytesFilled);
  const {
    stream,
  } = controller[kState];
  if (readableStreamHasBYOBReader(stream)) {
    while (readableStreamGetNumReadIntoRequests(stream) > 0) {
      readableByteStreamControllerCommitPullIntoDescriptor(
        stream,
        readableByteStreamControllerShiftPendingPullInto(controller));
    }
  }
}

function readableByteStreamControllerFillHeadPullIntoDescriptor(
  controller,
  size,
  desc) {
  const {
    pendingPullIntos,
    byobRequest,
  } = controller[kState];
  assert(!pendingPullIntos.length || pendingPullIntos[0] === desc);
  assert(byobRequest === null);
  desc.bytesFilled += size;
}

function readableByteStreamControllerEnqueue(
  controller,
  buffer,
  byteLength,
  byteOffset) {
  const {
    closeRequested,
    pendingPullIntos,
    queue,
    stream,
  } = controller[kState];

  if (closeRequested || stream[kState].state !== 'readable')
    return;

  const transferredBuffer = transferArrayBuffer(buffer);

  if (pendingPullIntos.length) {
    const firstPendingPullInto = pendingPullIntos[0];

    const pendingBufferByteLength =
      ArrayBufferGetByteLength(firstPendingPullInto.buffer);
    if (pendingBufferByteLength === 0) {
      throw new ERR_INVALID_STATE.TypeError(
        'Destination ArrayBuffer is zero-length or detached');
    }

    firstPendingPullInto.buffer =
      transferArrayBuffer(firstPendingPullInto.buffer);
  }

  readableByteStreamControllerInvalidateBYOBRequest(controller);

  if (readableStreamHasDefaultReader(stream)) {
    if (!readableStreamGetNumReadRequests(stream)) {
      readableByteStreamControllerEnqueueChunkToQueue(
        controller,
        transferredBuffer,
        byteOffset,
        byteLength);
    } else {
      assert(!queue.length);
      const transferredView =
        new Uint8Array(transferredBuffer, byteOffset, byteLength);
      readableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else if (readableStreamHasBYOBReader(stream)) {
    readableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength);
    readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
      controller);
  } else {
    assert(!isReadableStreamLocked(stream));
    readableByteStreamControllerEnqueueChunkToQueue(
      controller,
      transferredBuffer,
      byteOffset,
      byteLength);
  }
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function readableByteStreamControllerEnqueueChunkToQueue(
  controller,
  buffer,
  byteOffset,
  byteLength) {
  ArrayPrototypePush(
    controller[kState].queue,
    {
      buffer,
      byteOffset,
      byteLength,
    });
  controller[kState].queueTotalSize += byteLength;
}

function readableByteStreamControllerFillPullIntoDescriptorFromQueue(
  controller,
  desc) {
  const {
    buffer,
    byteLength,
    byteOffset,
    bytesFilled,
    elementSize,
  } = desc;
  const currentAlignedBytes = bytesFilled - (bytesFilled % elementSize);
  const maxBytesToCopy = MathMin(
    controller[kState].queueTotalSize,
    byteLength - bytesFilled);
  const maxBytesFilled = bytesFilled + maxBytesToCopy;
  const maxAlignedBytes = maxBytesFilled - (maxBytesFilled % elementSize);
  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  if (maxAlignedBytes > currentAlignedBytes) {
    totalBytesToCopyRemaining = maxAlignedBytes - bytesFilled;
    ready = true;
  }
  const {
    queue,
  } = controller[kState];

  while (totalBytesToCopyRemaining) {
    const headOfQueue = queue[0];
    const bytesToCopy = MathMin(
      totalBytesToCopyRemaining,
      headOfQueue.byteLength);
    const destStart = byteOffset + desc.bytesFilled;
    const arrayBufferByteLength = ArrayBufferGetByteLength(buffer);
    if (arrayBufferByteLength - destStart < bytesToCopy) {
      throw new ERR_INVALID_STATE.RangeError(
        'view ArrayBuffer size is invalid');
    }
    assert(arrayBufferByteLength - destStart >= bytesToCopy);
    copyArrayBuffer(
      buffer,
      destStart,
      headOfQueue.buffer,
      headOfQueue.byteOffset,
      bytesToCopy);
    if (headOfQueue.byteLength === bytesToCopy) {
      ArrayPrototypeShift(queue);
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller[kState].queueTotalSize -= bytesToCopy;
    readableByteStreamControllerFillHeadPullIntoDescriptor(
      controller,
      bytesToCopy,
      desc);
    totalBytesToCopyRemaining -= bytesToCopy;
  }

  if (!ready) {
    assert(!controller[kState].queueTotalSize);
    assert(desc.bytesFilled > 0);
    assert(desc.bytesFilled < elementSize);
  }
  return ready;
}

function readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(
  controller) {
  const {
    closeRequested,
    pendingPullIntos,
    stream,
  } = controller[kState];
  assert(!closeRequested);
  while (pendingPullIntos.length) {
    if (!controller[kState].queueTotalSize)
      return;
    const desc = pendingPullIntos[0];
    if (readableByteStreamControllerFillPullIntoDescriptorFromQueue(
      controller,
      desc)) {
      readableByteStreamControllerShiftPendingPullInto(controller);
      readableByteStreamControllerCommitPullIntoDescriptor(stream, desc);
    }
  }
}

function readableByteStreamControllerRespondInReadableState(
  controller,
  bytesWritten,
  desc) {
  const {
    buffer,
    bytesFilled,
    byteLength,
  } = desc;

  if (bytesFilled + bytesWritten > byteLength)
    throw new ERR_INVALID_STATE.RangeError('The buffer size is invalid');

  readableByteStreamControllerFillHeadPullIntoDescriptor(
    controller,
    bytesWritten,
    desc);

  if (desc.bytesFilled < desc.elementSize)
    return;

  readableByteStreamControllerShiftPendingPullInto(controller);

  const remainderSize = desc.bytesFilled % desc.elementSize;

  if (remainderSize) {
    const end = desc.byteOffset + desc.bytesFilled;
    const start = end - remainderSize;
    const remainder =
      ArrayBufferPrototypeSlice(
        buffer,
        start,
        end);
    readableByteStreamControllerEnqueueChunkToQueue(
      controller,
      remainder,
      0,
      ArrayBufferGetByteLength(remainder));
  }
  desc.bytesFilled -= remainderSize;
  readableByteStreamControllerCommitPullIntoDescriptor(
    controller[kState].stream,
    desc);
  readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
}

function readableByteStreamControllerRespondWithNewView(controller, view) {
  const {
    stream,
    pendingPullIntos,
  } = controller[kState];
  assert(pendingPullIntos.length);

  const desc = pendingPullIntos[0];
  assert(stream[kState].state !== 'errored');

  if (!isArrayBufferView(view)) {
    throw new ERR_INVALID_ARG_TYPE(
      'view',
      [
        'Buffer',
        'TypedArray',
        'DataView',
      ],
      view);
  }
  const viewByteLength = ArrayBufferViewGetByteLength(view);
  const viewByteOffset = ArrayBufferViewGetByteOffset(view);
  const viewBuffer = ArrayBufferViewGetBuffer(view);
  const viewBufferByteLength = ArrayBufferGetByteLength(viewBuffer);

  const {
    byteOffset,
    byteLength,
    bytesFilled,
    bufferByteLength,
  } = desc;

  if (byteOffset + bytesFilled !== viewByteOffset)
    throw new ERR_INVALID_ARG_VALUE.RangeError('view', view);

  if (bytesFilled + viewByteOffset > byteLength)
    throw new ERR_INVALID_ARG_VALUE.RangeError('view', view);

  if (bufferByteLength !== viewBufferByteLength)
    throw new ERR_INVALID_ARG_VALUE.RangeError('view', view);

  desc.buffer = transferArrayBuffer(viewBuffer);

  readableByteStreamControllerRespondInternal(controller, viewByteLength);
}

function readableByteStreamControllerShiftPendingPullInto(controller) {
  assert(controller[kState].byobRequest === null);
  return ArrayPrototypeShift(controller[kState].pendingPullIntos);
}

function readableByteStreamControllerCallPullIfNeeded(controller) {
  if (!readableByteStreamControllerShouldCallPull(controller))
    return;
  if (controller[kState].pulling) {
    controller[kState].pullAgain = true;
    return;
  }
  assert(!controller[kState].pullAgain);
  controller[kState].pulling = true;
  PromisePrototypeThen(
    ensureIsPromise(controller[kState].pullAlgorithm, controller),
    () => {
      controller[kState].pulling = false;
      if (controller[kState].pullAgain) {
        controller[kState].pullAgain = false;
        readableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    (error) => readableByteStreamControllerError(controller, error));
}

function readableByteStreamControllerError(controller, error) {
  const {
    stream,
  } = controller[kState];
  if (stream[kState].state !== 'readable')
    return;
  readableByteStreamControllerClearPendingPullIntos(controller);
  resetQueue(controller);
  readableByteStreamControllerClearAlgorithms(controller);
  readableStreamError(stream, error);
}

function readableByteStreamControllerCancelSteps(controller, reason) {
  readableByteStreamControllerClearPendingPullIntos(controller);
  resetQueue(controller);
  const result = controller[kState].cancelAlgorithm(reason);
  readableByteStreamControllerClearAlgorithms(controller);
  return result;
}

function readableByteStreamControllerPullSteps(controller, readRequest) {
  const {
    pendingPullIntos,
    queue,
    queueTotalSize,
    stream,
  } = controller[kState];
  assert(readableStreamHasDefaultReader(stream));
  if (queueTotalSize) {
    assert(!readableStreamGetNumReadRequests(stream));
    const {
      buffer,
      byteOffset,
      byteLength,
    } = ArrayPrototypeShift(queue);
    controller[kState].queueTotalSize -= byteLength;
    readableByteStreamControllerHandleQueueDrain(controller);
    const view = new Uint8Array(buffer, byteOffset, byteLength);
    readRequest[kChunk](view);
    return;
  }
  const {
    autoAllocateChunkSize,
  } = controller[kState];
  if (autoAllocateChunkSize !== undefined) {
    try {
      const buffer = new ArrayBuffer(autoAllocateChunkSize);
      ArrayPrototypePush(
        pendingPullIntos,
        {
          buffer,
          bufferByteLength: autoAllocateChunkSize,
          byteOffset: 0,
          byteLength: autoAllocateChunkSize,
          bytesFilled: 0,
          elementSize: 1,
          ctor: Uint8Array,
          type: 'default',
        });
    } catch (error) {
      readRequest[kError](error);
      return;
    }
  }

  readableStreamAddReadRequest(stream, readRequest);
  readableByteStreamControllerCallPullIfNeeded(controller);
}

function setupReadableByteStreamController(
  stream,
  controller,
  startAlgorithm,
  pullAlgorithm,
  cancelAlgorithm,
  highWaterMark,
  autoAllocateChunkSize) {
  assert(stream[kState].controller === undefined);
  if (autoAllocateChunkSize !== undefined) {
    assert(NumberIsInteger(autoAllocateChunkSize));
    assert(autoAllocateChunkSize > 0);
  }
  controller[kState] = {
    byobRequest: null,
    closeRequested: false,
    pullAgain: false,
    pulling: false,
    started: false,
    stream,
    queue: [],
    queueTotalSize: 0,
    highWaterMark,
    pullAlgorithm,
    cancelAlgorithm,
    autoAllocateChunkSize,
    pendingPullIntos: [],
  };
  stream[kState].controller = controller;

  const startResult = startAlgorithm();

  PromisePrototypeThen(
    PromiseResolve(startResult),
    () => {
      controller[kState].started = true;
      assert(!controller[kState].pulling);
      assert(!controller[kState].pullAgain);
      readableByteStreamControllerCallPullIfNeeded(controller);
    },
    (error) => readableByteStreamControllerError(controller, error));
}

function setupReadableByteStreamControllerFromSource(
  stream,
  source,
  highWaterMark) {
  const controller = createReadableByteStreamController();
  const start = source?.start;
  const pull = source?.pull;
  const cancel = source?.cancel;
  const autoAllocateChunkSize = source?.autoAllocateChunkSize;
  const startAlgorithm = start ?
    FunctionPrototypeBind(start, source, controller) :
    nonOpStart;
  const pullAlgorithm = pull ?
    FunctionPrototypeBind(pull, source, controller) :
    nonOpPull;
  const cancelAlgorithm = cancel ?
    FunctionPrototypeBind(cancel, source) :
    nonOpCancel;

  if (autoAllocateChunkSize === 0) {
    throw new ERR_INVALID_ARG_VALUE(
      'source.autoAllocateChunkSize',
      autoAllocateChunkSize);
  }
  setupReadableByteStreamController(
    stream,
    controller,
    startAlgorithm,
    pullAlgorithm,
    cancelAlgorithm,
    highWaterMark,
    autoAllocateChunkSize);
}

module.exports = {
  ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableByteStreamController,
  ReadableStreamDefaultController,
  TransferredReadableStream,

  // Exported Brand Checks
  isReadableStream,
  isReadableByteStreamController,
  isReadableStreamBYOBRequest,
  isReadableStreamDefaultReader,
  isReadableStreamBYOBReader,
  isWritableStreamDefaultWriter,
  isWritableStreamDefaultController,

  readableStreamPipeTo,
  readableStreamTee,
  readableByteStreamControllerConvertPullIntoDescriptor,
  isReadableStreamLocked,
  readableStreamCancel,
  readableStreamClose,
  readableStreamError,
  readableStreamHasDefaultReader,
  readableStreamGetNumReadRequests,
  readableStreamHasBYOBReader,
  readableStreamGetNumReadIntoRequests,
  readableStreamFulfillReadRequest,
  readableStreamFulfillReadIntoRequest,
  readableStreamAddReadRequest,
  readableStreamAddReadIntoRequest,
  readableStreamReaderGenericCancel,
  readableStreamReaderGenericInitialize,
  readableStreamReaderGenericRelease,
  readableStreamBYOBReaderRead,
  readableStreamDefaultReaderRead,
  setupReadableStreamBYOBReader,
  setupReadableStreamDefaultReader,
  readableStreamDefaultControllerClose,
  readableStreamDefaultControllerEnqueue,
  readableStreamDefaultControllerHasBackpressure,
  readableStreamDefaultControllerCanCloseOrEnqueue,
  readableStreamDefaultControllerGetDesiredSize,
  readableStreamDefaultControllerShouldCallPull,
  readableStreamDefaultControllerCallPullIfNeeded,
  readableStreamDefaultControllerClearAlgorithms,
  readableStreamDefaultControllerError,
  readableStreamDefaultControllerCancelSteps,
  readableStreamDefaultControllerPullSteps,
  setupReadableStreamDefaultController,
  setupReadableStreamDefaultControllerFromSource,
  readableByteStreamControllerClose,
  readableByteStreamControllerCommitPullIntoDescriptor,
  readableByteStreamControllerInvalidateBYOBRequest,
  readableByteStreamControllerClearAlgorithms,
  readableByteStreamControllerClearPendingPullIntos,
  readableByteStreamControllerGetDesiredSize,
  readableByteStreamControllerShouldCallPull,
  readableByteStreamControllerHandleQueueDrain,
  readableByteStreamControllerPullInto,
  readableByteStreamControllerRespondInternal,
  readableByteStreamControllerRespond,
  readableByteStreamControllerRespondInClosedState,
  readableByteStreamControllerFillHeadPullIntoDescriptor,
  readableByteStreamControllerEnqueue,
  readableByteStreamControllerEnqueueChunkToQueue,
  readableByteStreamControllerFillPullIntoDescriptorFromQueue,
  readableByteStreamControllerProcessPullIntoDescriptorsUsingQueue,
  readableByteStreamControllerRespondInReadableState,
  readableByteStreamControllerRespondWithNewView,
  readableByteStreamControllerShiftPendingPullInto,
  readableByteStreamControllerCallPullIfNeeded,
  readableByteStreamControllerError,
  readableByteStreamControllerCancelSteps,
  readableByteStreamControllerPullSteps,
  setupReadableByteStreamController,
  setupReadableByteStreamControllerFromSource,
};

/* eslint-enable no-use-before-define */
