'use strict';

const {
  ArrayPrototypeForEach,
  ArrayPrototypeJoin,
  ArrayPrototypeSome,
  ObjectDefineProperty,
  ObjectPrototypeHasOwnProperty,
  SafeMap,
  SafeSet,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeSlice,
  StringPrototypeStartsWith,
} = primordials;
const {
  ERR_INVALID_ARG_TYPE,
  ERR_MANIFEST_DEPENDENCY_MISSING,
  ERR_UNKNOWN_BUILTIN_MODULE,
} = require('internal/errors').codes;
const { BuiltinModule } = require('internal/bootstrap/loaders');

const { validateString } = require('internal/validators');
const path = require('path');
const { pathToFileURL, fileURLToPath, URL } = require('internal/url');

const { getOptionValue } = require('internal/options');
const { setOwnProperty } = require('internal/util');
const userConditions = getOptionValue('--conditions');

const {
  privateSymbols: {
    require_private_symbol,
  },
} = internalBinding('util');

let debug = require('internal/util/debuglog').debuglog('module', (fn) => {
  debug = fn;
});

const noAddons = getOptionValue('--no-addons');
const addonConditions = noAddons ? [] : ['node-addons'];

// TODO: Use this set when resolving pkg#exports conditions in loader.js.
const cjsConditions = new SafeSet([
  'require',
  'node',
  ...addonConditions,
  ...userConditions,
]);

function loadBuiltinModule(filename, request) {
  const mod = BuiltinModule.map.get(filename);
  if (mod?.canBeRequiredByUsers) {
    debug('load built-in module %s', request);
    // compileForPublicLoader() throws if mod.canBeRequiredByUsers is false:
    mod.compileForPublicLoader();
    return mod;
  }
}

let $Module = null;
function lazyModule() {
  $Module = $Module || require('internal/modules/cjs/loader').Module;
  return $Module;
}

// Invoke with makeRequireFunction(module) where |module| is the Module object
// to use as the context for the require() function.
// Use redirects to set up a mapping from a policy and restrict dependencies
const urlToFileCache = new SafeMap();
function makeRequireFunction(mod, redirects) {
  // lazy due to cycle
  const Module = lazyModule();
  if (mod instanceof Module !== true) {
    throw new ERR_INVALID_ARG_TYPE('mod', 'Module', mod);
  }

  let require;
  if (redirects) {
    const id = mod.filename || mod.id;
    const conditions = cjsConditions;
    const { resolve, reaction } = redirects;
    require = function require(specifier) {
      let missing = true;
      const destination = resolve(specifier, conditions);
      if (destination === true) {
        missing = false;
      } else if (destination) {
        const href = destination.href;
        if (destination.protocol === 'node:') {
          const specifier = destination.pathname;
          const mod = loadBuiltinModule(specifier, href);
          if (mod && mod.canBeRequiredByUsers) {
            return mod.exports;
          }
          throw new ERR_UNKNOWN_BUILTIN_MODULE(specifier);
        } else if (destination.protocol === 'file:') {
          let filepath;
          if (urlToFileCache.has(href)) {
            filepath = urlToFileCache.get(href);
          } else {
            filepath = fileURLToPath(destination);
            urlToFileCache.set(href, filepath);
          }
          return mod[require_private_symbol](mod, filepath);
        }
      }
      if (missing) {
        reaction(new ERR_MANIFEST_DEPENDENCY_MISSING(
          id,
          specifier,
          ArrayPrototypeJoin([...conditions], ', '),
        ));
      }
      return mod[require_private_symbol](mod, specifier);
    };
  } else {
    require = function require(path) {
      // When no policy manifest, the original prototype.require is sustained
      return mod.require(path);
    };
  }

  function resolve(request, options) {
    validateString(request, 'request');
    return Module._resolveFilename(request, mod, false, options);
  }

  require.resolve = resolve;

  function paths(request) {
    validateString(request, 'request');
    return Module._resolveLookupPaths(request, mod);
  }

  resolve.paths = paths;

  setOwnProperty(require, 'main', process.mainModule);

  // Enable support to add extra extension types.
  require.extensions = Module._extensions;

  require.cache = Module._cache;

  return require;
}

/**
 * Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
 * because the buffer-to-string conversion in `fs.readFileSync()`
 * translates it to FEFF, the UTF-16 BOM.
 */
function stripBOM(content) {
  if (StringPrototypeCharCodeAt(content) === 0xFEFF) {
    content = StringPrototypeSlice(content, 1);
  }
  return content;
}

function addBuiltinLibsToObject(object, dummyModuleName) {
  // Make built-in modules available directly (loaded lazily).
  const Module = require('internal/modules/cjs/loader').Module;
  const { builtinModules } = Module;

  // To require built-in modules in user-land and ignore modules whose
  // `canBeRequiredByUsers` is false. So we create a dummy module object and not
  // use `require()` directly.
  const dummyModule = new Module(dummyModuleName);

  ArrayPrototypeForEach(builtinModules, (name) => {
    // Neither add underscored modules, nor ones that contain slashes (e.g.,
    // 'fs/promises') or ones that are already defined.
    if (StringPrototypeStartsWith(name, '_') ||
        StringPrototypeIncludes(name, '/') ||
        ObjectPrototypeHasOwnProperty(object, name)) {
      return;
    }
    // Goals of this mechanism are:
    // - Lazy loading of built-in modules
    // - Having all built-in modules available as non-enumerable properties
    // - Allowing the user to re-assign these variables as if there were no
    //   pre-existing globals with the same name.

    const setReal = (val) => {
      // Deleting the property before re-assigning it disables the
      // getter/setter mechanism.
      delete object[name];
      object[name] = val;
    };

    ObjectDefineProperty(object, name, {
      __proto__: null,
      get: () => {
        const lib = dummyModule.require(name);

        try {
          // Override the current getter/setter and set up a new
          // non-enumerable property.
          ObjectDefineProperty(object, name, {
            __proto__: null,
            get: () => lib,
            set: setReal,
            configurable: true,
            enumerable: false,
          });
        } catch {
          // If the property is no longer configurable, ignore the error.
        }

        return lib;
      },
      set: setReal,
      configurable: true,
      enumerable: false,
    });
  });
}

/**
 *
 * @param {string | URL} referrer
 * @returns {string}
 */
function normalizeReferrerURL(referrer) {
  if (typeof referrer === 'string' && path.isAbsolute(referrer)) {
    return pathToFileURL(referrer).href;
  }
  return new URL(referrer).href;
}

// For error messages only - used to check if ESM syntax is in use.
function hasEsmSyntax(code) {
  debug('Checking for ESM syntax');
  const parser = require('internal/deps/acorn/acorn/dist/acorn').Parser;
  let root;
  try {
    root = parser.parse(code, { sourceType: 'module', ecmaVersion: 'latest' });
  } catch {
    return false;
  }

  return ArrayPrototypeSome(root.body, (stmt) =>
    stmt.type === 'ExportDefaultDeclaration' ||
    stmt.type === 'ExportNamedDeclaration' ||
    stmt.type === 'ImportDeclaration' ||
    stmt.type === 'ExportAllDeclaration');
}

module.exports = {
  addBuiltinLibsToObject,
  cjsConditions,
  hasEsmSyntax,
  loadBuiltinModule,
  makeRequireFunction,
  normalizeReferrerURL,
  stripBOM,
};
