// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Inspiration for this code comes from Salvatore Sanfilippo's linenoise.
// https://github.com/antirez/linenoise
// Reference:
// * https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
// * http://www.3waylabs.com/nw/WWW/products/wizcon/vt220.html

'use strict';

const {
  ArrayFrom,
  ArrayPrototypeFilter,
  ArrayPrototypeIndexOf,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePop,
  ArrayPrototypeReverse,
  ArrayPrototypeSplice,
  ArrayPrototypeUnshift,
  DateNow,
  FunctionPrototypeBind,
  FunctionPrototypeCall,
  MathCeil,
  MathFloor,
  MathMax,
  MathMaxApply,
  NumberIsFinite,
  NumberIsNaN,
  ObjectDefineProperty,
  ObjectSetPrototypeOf,
  RegExpPrototypeTest,
  StringPrototypeCodePointAt,
  StringPrototypeEndsWith,
  StringPrototypeMatch,
  StringPrototypeRepeat,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
  StringPrototypeTrim,
  Promise,
  PromiseReject,
  Symbol,
  SymbolAsyncIterator,
  SafeStringIterator,
} = primordials;

const {
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
} = require('internal/readline/callbacks');
const emitKeypressEvents = require('internal/readline/emitKeypressEvents');

const {
  AbortError,
  codes
} = require('internal/errors');

const {
  ERR_INVALID_ARG_VALUE,
} = codes;
const {
  validateAbortSignal,
  validateArray,
  validateString,
  validateUint32,
} = require('internal/validators');
const {
  inspect,
  getStringWidth,
  stripVTControlCharacters,
} = require('internal/util/inspect');
const EventEmitter = require('events');
const {
  charLengthAt,
  charLengthLeft,
  commonPrefix,
  kSubstringSearch,
} = require('internal/readline/utils');

const {
  kEmptyObject,
  promisify,
} = require('internal/util');

const { StringDecoder } = require('string_decoder');

// Lazy load Readable for startup performance.
let Readable;

/**
 * @typedef {import('./stream.js').Readable} Readable
 * @typedef {import('./stream.js').Writable} Writable
 */

const kHistorySize = 30;
const kMincrlfDelay = 100;
// \r\n, \n, or \r followed by something other than \n
const lineEnding = /\r?\n|\r(?!\n)/;

const kLineObjectStream = Symbol('line object stream');
const kQuestionCancel = Symbol('kQuestionCancel');

// GNU readline library - keyseq-timeout is 500ms (default)
const ESCAPE_CODE_TIMEOUT = 500;

/**
 * Creates a new `readline.Interface` instance.
 * @param {Readable | {
 *   input: Readable;
 *   output: Writable;
 *   completer?: Function;
 *   terminal?: boolean;
 *   history?: string[];
 *   historySize?: number;
 *   removeHistoryDuplicates?: boolean;
 *   prompt?: string;
 *   crlfDelay?: number;
 *   escapeCodeTimeout?: number;
 *   tabSize?: number;
 *   signal?: AbortSignal;
 *   }} input
 * @param {Writable} [output]
 * @param {Function} [completer]
 * @param {boolean} [terminal]
 * @returns {Interface}
 */
function createInterface(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
}


function Interface(input, output, completer, terminal) {
  if (!(this instanceof Interface)) {
    return new Interface(input, output, completer, terminal);
  }

  this._sawReturnAt = 0;
  // TODO(BridgeAR): Document this property. The name is not ideal, so we might
  // want to expose an alias and document that instead.
  this.isCompletionEnabled = true;
  this._sawKeyPress = false;
  this._previousKey = null;
  this.escapeCodeTimeout = ESCAPE_CODE_TIMEOUT;
  this.tabSize = 8;

  FunctionPrototypeCall(EventEmitter, this);
  let history;
  let historySize;
  let removeHistoryDuplicates = false;
  let crlfDelay;
  let prompt = '> ';
  let signal;
  if (input && input.input) {
    // An options object was given
    output = input.output;
    completer = input.completer;
    terminal = input.terminal;
    history = input.history;
    historySize = input.historySize;
    signal = input.signal;
    if (input.tabSize !== undefined) {
      validateUint32(input.tabSize, 'tabSize', true);
      this.tabSize = input.tabSize;
    }
    removeHistoryDuplicates = input.removeHistoryDuplicates;
    if (input.prompt !== undefined) {
      prompt = input.prompt;
    }
    if (input.escapeCodeTimeout !== undefined) {
      if (NumberIsFinite(input.escapeCodeTimeout)) {
        this.escapeCodeTimeout = input.escapeCodeTimeout;
      } else {
        throw new ERR_INVALID_ARG_VALUE(
          'input.escapeCodeTimeout',
          this.escapeCodeTimeout
        );
      }
    }

    if (signal) {
      validateAbortSignal(signal, 'options.signal');
    }

    crlfDelay = input.crlfDelay;
    input = input.input;
  }

  if (completer !== undefined && typeof completer !== 'function') {
    throw new ERR_INVALID_ARG_VALUE('completer', completer);
  }

  if (history === undefined) {
    history = [];
  } else {
    validateArray(history, 'history');
  }

  if (historySize === undefined) {
    historySize = kHistorySize;
  }

  if (typeof historySize !== 'number' ||
      NumberIsNaN(historySize) ||
      historySize < 0) {
    throw new ERR_INVALID_ARG_VALUE.RangeError('historySize', historySize);
  }

  // Backwards compat; check the isTTY prop of the output stream
  //  when `terminal` was not specified
  if (terminal === undefined && !(output === null || output === undefined)) {
    terminal = !!output.isTTY;
  }

  const self = this;

  this.line = '';
  this[kSubstringSearch] = null;
  this.output = output;
  this.input = input;
  this.history = history;
  this.historySize = historySize;
  this.removeHistoryDuplicates = !!removeHistoryDuplicates;
  this.crlfDelay = crlfDelay ?
    MathMax(kMincrlfDelay, crlfDelay) : kMincrlfDelay;
  // Check arity, 2 - for async, 1 for sync
  if (typeof completer === 'function') {
    this.completer = completer.length === 2 ?
      completer :
      function completerWrapper(v, cb) {
        cb(null, completer(v));
      };
  }

  this[kQuestionCancel] = FunctionPrototypeBind(_questionCancel, this);

  this.setPrompt(prompt);

  this.terminal = !!terminal;

  if (process.env.TERM === 'dumb') {
    this._ttyWrite = FunctionPrototypeBind(_ttyWriteDumb, this);
  }

  function onerror(err) {
    self.emit('error', err);
  }

  function ondata(data) {
    self._normalWrite(data);
  }

  function onend() {
    if (typeof self._line_buffer === 'string' &&
        self._line_buffer.length > 0) {
      self.emit('line', self._line_buffer);
    }
    self.close();
  }

  function ontermend() {
    if (typeof self.line === 'string' && self.line.length > 0) {
      self.emit('line', self.line);
    }
    self.close();
  }

  function onkeypress(s, key) {
    self._ttyWrite(s, key);
    if (key && key.sequence) {
      // If the key.sequence is half of a surrogate pair
      // (>= 0xd800 and <= 0xdfff), refresh the line so
      // the character is displayed appropriately.
      const ch = StringPrototypeCodePointAt(key.sequence, 0);
      if (ch >= 0xd800 && ch <= 0xdfff)
        self._refreshLine();
    }
  }

  function onresize() {
    self._refreshLine();
  }

  this[kLineObjectStream] = undefined;

  input.on('error', onerror);

  if (!this.terminal) {
    function onSelfCloseWithoutTerminal() {
      input.removeListener('data', ondata);
      input.removeListener('error', onerror);
      input.removeListener('end', onend);
    }

    input.on('data', ondata);
    input.on('end', onend);
    self.once('close', onSelfCloseWithoutTerminal);
    this._decoder = new StringDecoder('utf8');
  } else {
    function onSelfCloseWithTerminal() {
      input.removeListener('keypress', onkeypress);
      input.removeListener('error', onerror);
      input.removeListener('end', ontermend);
      if (output !== null && output !== undefined) {
        output.removeListener('resize', onresize);
      }
    }

    emitKeypressEvents(input, this);

    // `input` usually refers to stdin
    input.on('keypress', onkeypress);
    input.on('end', ontermend);

    this._setRawMode(true);
    this.terminal = true;

    // Cursor position on the line.
    this.cursor = 0;

    this.historyIndex = -1;

    if (output !== null && output !== undefined)
      output.on('resize', onresize);

    self.once('close', onSelfCloseWithTerminal);
  }

  if (signal) {
    const onAborted = () => self.close();
    if (signal.aborted) {
      process.nextTick(onAborted);
    } else {
      signal.addEventListener('abort', onAborted, { once: true });
      self.once('close', () => signal.removeEventListener('abort', onAborted));
    }
  }

  // Current line
  this.line = '';

  input.resume();
}

ObjectSetPrototypeOf(Interface.prototype, EventEmitter.prototype);
ObjectSetPrototypeOf(Interface, EventEmitter);

ObjectDefineProperty(Interface.prototype, 'columns', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: function() {
    if (this.output && this.output.columns)
      return this.output.columns;
    return Infinity;
  }
});

/**
 * Sets the prompt written to the output.
 * @param {string} prompt
 * @returns {void}
 */
Interface.prototype.setPrompt = function(prompt) {
  this._prompt = prompt;
};

/**
 * Returns the current prompt used by `rl.prompt()`.
 * @returns {string}
 */
Interface.prototype.getPrompt = function() {
  return this._prompt;
};


Interface.prototype._setRawMode = function(mode) {
  const wasInRawMode = this.input.isRaw;

  if (typeof this.input.setRawMode === 'function') {
    this.input.setRawMode(mode);
  }

  return wasInRawMode;
};

/**
 * Writes the configured `prompt` to a new line in `output`.
 * @param {boolean} [preserveCursor]
 * @returns {void}
 */
Interface.prototype.prompt = function(preserveCursor) {
  if (this.paused) this.resume();
  if (this.terminal && process.env.TERM !== 'dumb') {
    if (!preserveCursor) this.cursor = 0;
    this._refreshLine();
  } else {
    this._writeToOutput(this._prompt);
  }
};

/**
 * Displays `query` by writing it to the `output`.
 * @param {string} query
 * @param {{ signal?: AbortSignal; }} [options]
 * @param {Function} cb
 * @returns {void}
 */
Interface.prototype.question = function(query, options, cb) {
  cb = typeof options === 'function' ? options : cb;
  options = typeof options === 'object' && options !== null ? options : {};

  if (options.signal) {
    if (options.signal.aborted) {
      return;
    }

    options.signal.addEventListener('abort', () => {
      this[kQuestionCancel]();
    }, { once: true });
  }

  if (typeof cb === 'function') {
    if (this._questionCallback) {
      this.prompt();
    } else {
      this._oldPrompt = this._prompt;
      this.setPrompt(query);
      this._questionCallback = cb;
      this.prompt();
    }
  }
};

Interface.prototype.question[promisify.custom] = function question(query, options) {
  options = typeof options === 'object' && options !== null ? options : {};

  if (options.signal && options.signal.aborted) {
    return PromiseReject(new AbortError());
  }

  return new Promise((resolve, reject) => {
    this.question(query, options, resolve);

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        reject(new AbortError());
      }, { once: true });
    }
  });
};

function _questionCancel() {
  if (this._questionCallback) {
    this._questionCallback = null;
    this.setPrompt(this._oldPrompt);
    this.clearLine();
  }
}


Interface.prototype._onLine = function(line) {
  if (this._questionCallback) {
    const cb = this._questionCallback;
    this._questionCallback = null;
    this.setPrompt(this._oldPrompt);
    cb(line);
  } else {
    this.emit('line', line);
  }
};

Interface.prototype._writeToOutput = function _writeToOutput(stringToWrite) {
  validateString(stringToWrite, 'stringToWrite');

  if (this.output !== null && this.output !== undefined) {
    this.output.write(stringToWrite);
  }
};

Interface.prototype._addHistory = function() {
  if (this.line.length === 0) return '';

  // If the history is disabled then return the line
  if (this.historySize === 0) return this.line;

  // If the trimmed line is empty then return the line
  if (StringPrototypeTrim(this.line).length === 0) return this.line;

  if (this.history.length === 0 || this.history[0] !== this.line) {
    if (this.removeHistoryDuplicates) {
      // Remove older history line if identical to new one
      const dupIndex = ArrayPrototypeIndexOf(this.history, this.line);
      if (dupIndex !== -1) ArrayPrototypeSplice(this.history, dupIndex, 1);
    }

    ArrayPrototypeUnshift(this.history, this.line);

    // Only store so many
    if (this.history.length > this.historySize) ArrayPrototypePop(this.history);
  }

  this.historyIndex = -1;

  // The listener could change the history object, possibly
  // to remove the last added entry if it is sensitive and should
  // not be persisted in the history, like a password
  const line = this.history[0];

  // Emit history event to notify listeners of update
  this.emit('history', this.history);

  return line;
};


Interface.prototype._refreshLine = function() {
  // line length
  const line = this._prompt + this.line;
  const dispPos = this._getDisplayPos(line);
  const lineCols = dispPos.cols;
  const lineRows = dispPos.rows;

  // cursor position
  const cursorPos = this.getCursorPos();

  // First move to the bottom of the current line, based on cursor pos
  const prevRows = this.prevRows || 0;
  if (prevRows > 0) {
    moveCursor(this.output, 0, -prevRows);
  }

  // Cursor to left edge.
  cursorTo(this.output, 0);
  // erase data
  clearScreenDown(this.output);

  // Write the prompt and the current buffer content.
  this._writeToOutput(line);

  // Force terminal to allocate a new line
  if (lineCols === 0) {
    this._writeToOutput(' ');
  }

  // Move cursor to original position.
  cursorTo(this.output, cursorPos.cols);

  const diff = lineRows - cursorPos.rows;
  if (diff > 0) {
    moveCursor(this.output, 0, -diff);
  }

  this.prevRows = cursorPos.rows;
};

/**
 * Closes the `readline.Interface` instance.
 * @returns {void}
 */
Interface.prototype.close = function() {
  if (this.closed) return;
  this.pause();
  if (this.terminal) {
    this._setRawMode(false);
  }
  this.closed = true;
  this.emit('close');
};

/**
 * Pauses the `input` stream.
 * @returns {void | Interface}
 */
Interface.prototype.pause = function() {
  if (this.paused) return;
  this.input.pause();
  this.paused = true;
  this.emit('pause');
  return this;
};

/**
 * Resumes the `input` stream if paused.
 * @returns {void | Interface}
 */
Interface.prototype.resume = function() {
  if (!this.paused) return;
  this.input.resume();
  this.paused = false;
  this.emit('resume');
  return this;
};

/**
 * Writes either `data` or a `key` sequence identified by
 * `key` to the `output`.
 * @param {string} d
 * @param {{
 *   ctrl?: boolean;
 *   meta?: boolean;
 *   shift?: boolean;
 *   name?: string;
 *   }} [key]
 * @returns {void}
 */
Interface.prototype.write = function(d, key) {
  if (this.paused) this.resume();
  if (this.terminal) {
    this._ttyWrite(d, key);
  } else {
    this._normalWrite(d);
  }
};

Interface.prototype._normalWrite = function(b) {
  if (b === undefined) {
    return;
  }
  let string = this._decoder.write(b);
  if (this._sawReturnAt &&
      DateNow() - this._sawReturnAt <= this.crlfDelay) {
    string = StringPrototypeReplace(string, /^\n/, '');
    this._sawReturnAt = 0;
  }

  // Run test() on the new string chunk, not on the entire line buffer.
  const newPartContainsEnding = RegExpPrototypeTest(lineEnding, string);

  if (this._line_buffer) {
    string = this._line_buffer + string;
    this._line_buffer = null;
  }
  if (newPartContainsEnding) {
    this._sawReturnAt = StringPrototypeEndsWith(string, '\r') ? DateNow() : 0;

    // Got one or more newlines; process into "line" events
    const lines = StringPrototypeSplit(string, lineEnding);
    // Either '' or (conceivably) the unfinished portion of the next line
    string = ArrayPrototypePop(lines);
    this._line_buffer = string;
    for (let n = 0; n < lines.length; n++)
      this._onLine(lines[n]);
  } else if (string) {
    // No newlines this time, save what we have for next time
    this._line_buffer = string;
  }
};

Interface.prototype._insertString = function(c) {
  if (this.cursor < this.line.length) {
    const beg = StringPrototypeSlice(this.line, 0, this.cursor);
    const end = StringPrototypeSlice(this.line, this.cursor, this.line.length);
    this.line = beg + c + end;
    this.cursor += c.length;
    this._refreshLine();
  } else {
    this.line += c;
    this.cursor += c.length;

    if (this.getCursorPos().cols === 0) {
      this._refreshLine();
    } else {
      this._writeToOutput(c);
    }
  }
};

Interface.prototype._tabComplete = function(lastKeypressWasTab) {
  this.pause();
  const string = StringPrototypeSlice(this.line, 0, this.cursor);
  this.completer(string, (err, value) => {
    this.resume();

    if (err) {
      this._writeToOutput(`Tab completion error: ${inspect(err)}`);
      return;
    }

    // Result and the text that was completed.
    const { 0: completions, 1: completeOn } = value;

    if (!completions || completions.length === 0) {
      return;
    }

    // If there is a common prefix to all matches, then apply that portion.
    const prefix = commonPrefix(ArrayPrototypeFilter(completions,
                                                     (e) => e !== ''));
    if (StringPrototypeStartsWith(prefix, completeOn) &&
        prefix.length > completeOn.length) {
      this._insertString(StringPrototypeSlice(prefix, completeOn.length));
      return;
    } else if (!StringPrototypeStartsWith(completeOn, prefix)) {
      this.line = StringPrototypeSlice(this.line,
                                       0,
                                       this.cursor - completeOn.length) +
                  prefix +
                  StringPrototypeSlice(this.line,
                                       this.cursor,
                                       this.line.length);
      this.cursor = this.cursor - completeOn.length + prefix.length;
      this._refreshLine();
      return;
    }

    if (!lastKeypressWasTab) {
      return;
    }

    // Apply/show completions.
    const completionsWidth = ArrayPrototypeMap(completions,
                                               (e) => getStringWidth(e));
    const width = MathMaxApply(completionsWidth) + 2; // 2 space padding
    let maxColumns = MathFloor(this.columns / width) || 1;
    if (maxColumns === Infinity) {
      maxColumns = 1;
    }
    let output = '\r\n';
    let lineIndex = 0;
    let whitespace = 0;
    for (let i = 0; i < completions.length; i++) {
      const completion = completions[i];
      if (completion === '' || lineIndex === maxColumns) {
        output += '\r\n';
        lineIndex = 0;
        whitespace = 0;
      } else {
        output += StringPrototypeRepeat(' ', whitespace);
      }
      if (completion !== '') {
        output += completion;
        whitespace = width - completionsWidth[i];
        lineIndex++;
      } else {
        output += '\r\n';
      }
    }
    if (lineIndex !== 0) {
      output += '\r\n\r\n';
    }
    this._writeToOutput(output);
    this._refreshLine();
  });
};

Interface.prototype._wordLeft = function() {
  if (this.cursor > 0) {
    // Reverse the string and match a word near beginning
    // to avoid quadratic time complexity
    const leading = StringPrototypeSlice(this.line, 0, this.cursor);
    const reversed = ArrayPrototypeJoin(
      ArrayPrototypeReverse(ArrayFrom(leading)), '');
    const match = StringPrototypeMatch(reversed, /^\s*(?:[^\w\s]+|\w+)?/);
    this._moveCursor(-match[0].length);
  }
};


Interface.prototype._wordRight = function() {
  if (this.cursor < this.line.length) {
    const trailing = StringPrototypeSlice(this.line, this.cursor);
    const match = StringPrototypeMatch(trailing, /^(?:\s+|[^\w\s]+|\w+)\s*/);
    this._moveCursor(match[0].length);
  }
};

Interface.prototype._deleteLeft = function() {
  if (this.cursor > 0 && this.line.length > 0) {
    // The number of UTF-16 units comprising the character to the left
    const charSize = charLengthLeft(this.line, this.cursor);
    this.line = StringPrototypeSlice(this.line, 0, this.cursor - charSize) +
                StringPrototypeSlice(this.line, this.cursor, this.line.length);

    this.cursor -= charSize;
    this._refreshLine();
  }
};


Interface.prototype._deleteRight = function() {
  if (this.cursor < this.line.length) {
    // The number of UTF-16 units comprising the character to the left
    const charSize = charLengthAt(this.line, this.cursor);
    this.line = StringPrototypeSlice(this.line, 0, this.cursor) +
      StringPrototypeSlice(this.line, this.cursor + charSize, this.line.length);
    this._refreshLine();
  }
};


Interface.prototype._deleteWordLeft = function() {
  if (this.cursor > 0) {
    // Reverse the string and match a word near beginning
    // to avoid quadratic time complexity
    let leading = StringPrototypeSlice(this.line, 0, this.cursor);
    const reversed = ArrayPrototypeJoin(
      ArrayPrototypeReverse(ArrayFrom(leading)), '');
    const match = StringPrototypeMatch(reversed, /^\s*(?:[^\w\s]+|\w+)?/);
    leading = StringPrototypeSlice(leading, 0,
                                   leading.length - match[0].length);
    this.line = leading + StringPrototypeSlice(this.line, this.cursor,
                                               this.line.length);
    this.cursor = leading.length;
    this._refreshLine();
  }
};


Interface.prototype._deleteWordRight = function() {
  if (this.cursor < this.line.length) {
    const trailing = StringPrototypeSlice(this.line, this.cursor);
    const match = StringPrototypeMatch(trailing, /^(?:\s+|\W+|\w+)\s*/);
    this.line = StringPrototypeSlice(this.line, 0, this.cursor) +
                StringPrototypeSlice(trailing, match[0].length);
    this._refreshLine();
  }
};


Interface.prototype._deleteLineLeft = function() {
  this.line = StringPrototypeSlice(this.line, this.cursor);
  this.cursor = 0;
  this._refreshLine();
};


Interface.prototype._deleteLineRight = function() {
  this.line = StringPrototypeSlice(this.line, 0, this.cursor);
  this._refreshLine();
};


Interface.prototype.clearLine = function() {
  this._moveCursor(+Infinity);
  this._writeToOutput('\r\n');
  this.line = '';
  this.cursor = 0;
  this.prevRows = 0;
};


Interface.prototype._line = function() {
  const line = this._addHistory();
  this.clearLine();
  this._onLine(line);
};

// TODO(BridgeAR): Add underscores to the search part and a red background in
// case no match is found. This should only be the visual part and not the
// actual line content!
// TODO(BridgeAR): In case the substring based search is active and the end is
// reached, show a comment how to search the history as before. E.g., using
// <ctrl> + N. Only show this after two/three UPs or DOWNs, not on the first
// one.
Interface.prototype._historyNext = function() {
  if (this.historyIndex >= 0) {
    const search = this[kSubstringSearch] || '';
    let index = this.historyIndex - 1;
    while (index >= 0 &&
           (!StringPrototypeStartsWith(this.history[index], search) ||
             this.line === this.history[index])) {
      index--;
    }
    if (index === -1) {
      this.line = search;
    } else {
      this.line = this.history[index];
    }
    this.historyIndex = index;
    this.cursor = this.line.length; // Set cursor to end of line.
    this._refreshLine();
  }
};

Interface.prototype._historyPrev = function() {
  if (this.historyIndex < this.history.length && this.history.length) {
    const search = this[kSubstringSearch] || '';
    let index = this.historyIndex + 1;
    while (index < this.history.length &&
           (!StringPrototypeStartsWith(this.history[index], search) ||
             this.line === this.history[index])) {
      index++;
    }
    if (index === this.history.length) {
      this.line = search;
    } else {
      this.line = this.history[index];
    }
    this.historyIndex = index;
    this.cursor = this.line.length; // Set cursor to end of line.
    this._refreshLine();
  }
};

// Returns the last character's display position of the given string
Interface.prototype._getDisplayPos = function(str) {
  let offset = 0;
  const col = this.columns;
  let rows = 0;
  str = stripVTControlCharacters(str);
  for (const char of new SafeStringIterator(str)) {
    if (char === '\n') {
      // Rows must be incremented by 1 even if offset = 0 or col = +Infinity.
      rows += MathCeil(offset / col) || 1;
      offset = 0;
      continue;
    }
    // Tabs must be aligned by an offset of the tab size.
    if (char === '\t') {
      offset += this.tabSize - (offset % this.tabSize);
      continue;
    }
    const width = getStringWidth(char);
    if (width === 0 || width === 1) {
      offset += width;
    } else { // width === 2
      if ((offset + 1) % col === 0) {
        offset++;
      }
      offset += 2;
    }
  }
  const cols = offset % col;
  rows += (offset - cols) / col;
  return { cols, rows };
};

/**
 * Returns the real position of the cursor in relation
 * to the input prompt + string.
 * @returns {{
 *   rows: number;
 *   cols: number;
 *   }}
 */
Interface.prototype.getCursorPos = function() {
  const strBeforeCursor = this._prompt +
                          StringPrototypeSlice(this.line, 0, this.cursor);
  return this._getDisplayPos(strBeforeCursor);
};
Interface.prototype._getCursorPos = Interface.prototype.getCursorPos;

// This function moves cursor dx places to the right
// (-dx for left) and refreshes the line if it is needed.
Interface.prototype._moveCursor = function(dx) {
  if (dx === 0) {
    return;
  }
  const oldPos = this.getCursorPos();
  this.cursor += dx;

  // Bounds check
  if (this.cursor < 0) {
    this.cursor = 0;
  } else if (this.cursor > this.line.length) {
    this.cursor = this.line.length;
  }

  const newPos = this.getCursorPos();

  // Check if cursor stayed on the line.
  if (oldPos.rows === newPos.rows) {
    const diffWidth = newPos.cols - oldPos.cols;
    moveCursor(this.output, diffWidth, 0);
  } else {
    this._refreshLine();
  }
};

function _ttyWriteDumb(s, key) {
  key = key || kEmptyObject;

  if (key.name === 'escape') return;

  if (this._sawReturnAt && key.name !== 'enter')
    this._sawReturnAt = 0;

  if (key.ctrl) {
    if (key.name === 'c') {
      if (this.listenerCount('SIGINT') > 0) {
        this.emit('SIGINT');
      } else {
        // This readline instance is finished
        this.close();
      }

      return;
    } else if (key.name === 'd') {
      this.close();
      return;
    }
  }

  switch (key.name) {
    case 'return':  // Carriage return, i.e. \r
      this._sawReturnAt = DateNow();
      this._line();
      break;

    case 'enter':
      // When key interval > crlfDelay
      if (this._sawReturnAt === 0 ||
          DateNow() - this._sawReturnAt > this.crlfDelay) {
        this._line();
      }
      this._sawReturnAt = 0;
      break;

    default:
      if (typeof s === 'string' && s) {
        this.line += s;
        this.cursor += s.length;
        this._writeToOutput(s);
      }
  }
}

// Handle a write from the tty
Interface.prototype._ttyWrite = function(s, key) {
  const previousKey = this._previousKey;
  key = key || {};
  this._previousKey = key;

  // Activate or deactivate substring search.
  if ((key.name === 'up' || key.name === 'down') &&
      !key.ctrl && !key.meta && !key.shift) {
    if (this[kSubstringSearch] === null) {
      this[kSubstringSearch] = StringPrototypeSlice(this.line, 0, this.cursor);
    }
  } else if (this[kSubstringSearch] !== null) {
    this[kSubstringSearch] = null;
    // Reset the index in case there's no match.
    if (this.history.length === this.historyIndex) {
      this.historyIndex = -1;
    }
  }

  // Ignore escape key, fixes
  // https://github.com/nodejs/node-v0.x-archive/issues/2876.
  if (key.name === 'escape') return;

  if (key.ctrl && key.shift) {
    /* Control and shift pressed */
    switch (key.name) {
      // TODO(BridgeAR): The transmitted escape sequence is `\b` and that is
      // identical to <ctrl>-h. It should have a unique escape sequence.
      case 'backspace':
        this._deleteLineLeft();
        break;

      case 'delete':
        this._deleteLineRight();
        break;
    }

  } else if (key.ctrl) {
    /* Control key pressed */

    switch (key.name) {
      case 'c':
        if (this.listenerCount('SIGINT') > 0) {
          this.emit('SIGINT');
        } else {
          // This readline instance is finished
          this.close();
        }
        break;

      case 'h': // delete left
        this._deleteLeft();
        break;

      case 'd': // delete right or EOF
        if (this.cursor === 0 && this.line.length === 0) {
          // This readline instance is finished
          this.close();
        } else if (this.cursor < this.line.length) {
          this._deleteRight();
        }
        break;

      case 'u': // Delete from current to start of line
        this._deleteLineLeft();
        break;

      case 'k': // Delete from current to end of line
        this._deleteLineRight();
        break;

      case 'a': // Go to the start of the line
        this._moveCursor(-Infinity);
        break;

      case 'e': // Go to the end of the line
        this._moveCursor(+Infinity);
        break;

      case 'b': // back one character
        this._moveCursor(-charLengthLeft(this.line, this.cursor));
        break;

      case 'f': // Forward one character
        this._moveCursor(+charLengthAt(this.line, this.cursor));
        break;

      case 'l': // Clear the whole screen
        cursorTo(this.output, 0, 0);
        clearScreenDown(this.output);
        this._refreshLine();
        break;

      case 'n': // next history item
        this._historyNext();
        break;

      case 'p': // Previous history item
        this._historyPrev();
        break;

      case 'z':
        if (process.platform === 'win32') break;
        if (this.listenerCount('SIGTSTP') > 0) {
          this.emit('SIGTSTP');
        } else {
          process.once('SIGCONT', () => {
            // Don't raise events if stream has already been abandoned.
            if (!this.paused) {
              // Stream must be paused and resumed after SIGCONT to catch
              // SIGINT, SIGTSTP, and EOF.
              this.pause();
              this.emit('SIGCONT');
            }
            // Explicitly re-enable "raw mode" and move the cursor to
            // the correct position.
            // See https://github.com/joyent/node/issues/3295.
            this._setRawMode(true);
            this._refreshLine();
          });
          this._setRawMode(false);
          process.kill(process.pid, 'SIGTSTP');
        }
        break;

      case 'w': // Delete backwards to a word boundary
      // TODO(BridgeAR): The transmitted escape sequence is `\b` and that is
      // identical to <ctrl>-h. It should have a unique escape sequence.
      // Falls through
      case 'backspace':
        this._deleteWordLeft();
        break;

      case 'delete': // Delete forward to a word boundary
        this._deleteWordRight();
        break;

      case 'left':
        this._wordLeft();
        break;

      case 'right':
        this._wordRight();
        break;
    }

  } else if (key.meta) {
    /* Meta key pressed */

    switch (key.name) {
      case 'b': // backward word
        this._wordLeft();
        break;

      case 'f': // forward word
        this._wordRight();
        break;

      case 'd': // delete forward word
      case 'delete':
        this._deleteWordRight();
        break;

      case 'backspace': // Delete backwards to a word boundary
        this._deleteWordLeft();
        break;
    }

  } else {
    /* No modifier keys used */

    // \r bookkeeping is only relevant if a \n comes right after.
    if (this._sawReturnAt && key.name !== 'enter')
      this._sawReturnAt = 0;

    switch (key.name) {
      case 'return':  // Carriage return, i.e. \r
        this._sawReturnAt = DateNow();
        this._line();
        break;

      case 'enter':
        // When key interval > crlfDelay
        if (this._sawReturnAt === 0 ||
            DateNow() - this._sawReturnAt > this.crlfDelay) {
          this._line();
        }
        this._sawReturnAt = 0;
        break;

      case 'backspace':
        this._deleteLeft();
        break;

      case 'delete':
        this._deleteRight();
        break;

      case 'left':
        // Obtain the code point to the left
        this._moveCursor(-charLengthLeft(this.line, this.cursor));
        break;

      case 'right':
        this._moveCursor(+charLengthAt(this.line, this.cursor));
        break;

      case 'home':
        this._moveCursor(-Infinity);
        break;

      case 'end':
        this._moveCursor(+Infinity);
        break;

      case 'up':
        this._historyPrev();
        break;

      case 'down':
        this._historyNext();
        break;

      case 'tab':
        // If tab completion enabled, do that...
        if (typeof this.completer === 'function' && this.isCompletionEnabled) {
          const lastKeypressWasTab = previousKey && previousKey.name === 'tab';
          this._tabComplete(lastKeypressWasTab);
          break;
        }
      // falls through
      default:
        if (typeof s === 'string' && s) {
          const lines = StringPrototypeSplit(s, /\r\n|\n|\r/);
          for (let i = 0, len = lines.length; i < len; i++) {
            if (i > 0) {
              this._line();
            }
            this._insertString(lines[i]);
          }
        }
    }
  }
};

/**
 * Creates an `AsyncIterator` object that iterates through
 * each line in the input stream as a string.
 * @typedef {{
 *   [Symbol.asyncIterator]: () => InterfaceAsyncIterator,
 *   next: () => Promise<string>
 * }} InterfaceAsyncIterator
 * @returns {InterfaceAsyncIterator}
 */
Interface.prototype[SymbolAsyncIterator] = function() {
  if (this[kLineObjectStream] === undefined) {
    if (Readable === undefined) {
      Readable = require('stream').Readable;
    }
    const readable = new Readable({
      objectMode: true,
      read: () => {
        this.resume();
      },
      destroy: (err, cb) => {
        this.off('line', lineListener);
        this.off('close', closeListener);
        this.close();
        cb(err);
      }
    });
    const lineListener = (input) => {
      if (!readable.push(input)) {
        // TODO(rexagod): drain to resume flow
        this.pause();
      }
    };
    const closeListener = () => {
      readable.push(null);
    };
    const errorListener = (err) => {
      readable.destroy(err);
    };
    this.on('error', errorListener);
    this.on('line', lineListener);
    this.on('close', closeListener);
    this[kLineObjectStream] = readable;
  }

  return this[kLineObjectStream][SymbolAsyncIterator]();
};

module.exports = {
  Interface,
  clearLine,
  clearScreenDown,
  createInterface,
  cursorTo,
  emitKeypressEvents,
  moveCursor
};
