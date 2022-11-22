# ECMAScript modules

<!--introduced_in=v8.5.0-->
<!-- type=misc -->

> Stability: 1 - Experimental

## Introduction

<!--name=esm-->

ECMAScript modules are [the official standard format][] to package JavaScript
code for reuse. Modules are defined using a variety of [`import`][] and
[`export`][] statements.

The following example of an ES module exports a function:

```js
// addTwo.mjs
function addTwo(num) {
  return num + 2;
}

export { addTwo };
```

The following example of an ES module imports the function from `addTwo.mjs`:

```js
// app.mjs
import { addTwo } from './addTwo.mjs';

// Prints: 6
console.log(addTwo(4));
```

Node.js fully supports ECMAScript modules as they are currently specified and
provides limited interoperability between them and the existing module format,
[CommonJS][].

Node.js contains support for ES Modules based upon the
[Node.js EP for ES Modules][] and the [ECMAScript-modules implementation][].

Expect major changes in the implementation including interoperability support,
specifier resolution, and default behavior.

## Enabling

<!-- type=misc -->

Experimental support for ECMAScript modules is enabled by default.
Node.js will treat the following as ES modules when passed to `node` as the
initial input, or when referenced by `import` statements within ES module code:

* Files ending in `.mjs`.

* Files ending in `.js` when the nearest parent `package.json` file contains a
  top-level field `"type"` with a value of `"module"`.

* Strings passed in as an argument to `--eval` or `--print`, or piped to
  `node` via `STDIN`, with the flag `--input-type=module`.

Node.js will treat as CommonJS all other forms of input, such as `.js` files
where the nearest parent `package.json` file contains no top-level `"type"`
field, or string input without the flag `--input-type`. This behavior is to
preserve backward compatibility. However, now that Node.js supports both
CommonJS and ES modules, it is best to be explicit whenever possible. Node.js
will treat the following as CommonJS when passed to `node` as the initial input,
or when referenced by `import` statements within ES module code:

* Files ending in `.cjs`.

* Files ending in `.js` when the nearest parent `package.json` file contains a
  top-level field `"type"` with a value of `"commonjs"`.

* Strings passed in as an argument to `--eval` or `--print`, or piped to
  `node` via `STDIN`, with the flag `--input-type=commonjs`.

### `package.json` `"type"` field

Files ending with `.js` will be loaded as ES modules when the nearest parent
`package.json` file contains a top-level field `"type"` with a value of
`"module"`.

The nearest parent `package.json` is defined as the first `package.json` found
when searching in the current folder, that folder’s parent, and so on up
until the root of the volume is reached.

<!-- eslint-skip -->
```js
// package.json
{
  "type": "module"
}
```

```bash
# In same folder as preceding package.json
node my-app.js # Runs as ES module
```

If the nearest parent `package.json` lacks a `"type"` field, or contains
`"type": "commonjs"`, `.js` files are treated as CommonJS. If the volume root is
reached and no `package.json` is found, Node.js defers to the default, a
`package.json` with no `"type"` field.

`import` statements of `.js` files are treated as ES modules if the nearest
parent `package.json` contains `"type": "module"`.

```js
// my-app.js, part of the same example as above
import './startup.js'; // Loaded as ES module because of package.json
```

Package authors should include the `"type"` field, even in packages where all
sources are CommonJS. Being explicit about the `type` of the package will
future-proof the package in case the default type of Node.js ever changes, and
it will also make things easier for build tools and loaders to determine how the
files in the package should be interpreted.

Regardless of the value of the `"type"` field, `.mjs` files are always treated
as ES modules and `.cjs` files are always treated as CommonJS.

### Package scope and file extensions

A folder containing a `package.json` file, and all subfolders below that folder
until the next folder containing another `package.json`, are a
_package scope_. The `"type"` field defines how to treat `.js` files
within the package scope. Every package in a
project’s `node_modules` folder contains its own `package.json` file, so each
project’s dependencies have their own package scopes. If a `package.json` file
does not have a `"type"` field, the default `"type"` is `"commonjs"`.

The package scope applies not only to initial entry points (`node my-app.js`)
but also to files referenced by `import` statements and `import()` expressions.

```js
// my-app.js, in an ES module package scope because there is a package.json
// file in the same folder with "type": "module".

import './startup/init.js';
// Loaded as ES module since ./startup contains no package.json file,
// and therefore inherits the ES module package scope from one level up.

import 'commonjs-package';
// Loaded as CommonJS since ./node_modules/commonjs-package/package.json
// lacks a "type" field or contains "type": "commonjs".

import './node_modules/commonjs-package/index.js';
// Loaded as CommonJS since ./node_modules/commonjs-package/package.json
// lacks a "type" field or contains "type": "commonjs".
```

Files ending with `.mjs` are always loaded as ES modules regardless of package
scope.

Files ending with `.cjs` are always loaded as CommonJS regardless of package
scope.

```js
import './legacy-file.cjs';
// Loaded as CommonJS since .cjs is always loaded as CommonJS.

import 'commonjs-package/src/index.mjs';
// Loaded as ES module since .mjs is always loaded as ES module.
```

The `.mjs` and `.cjs` extensions may be used to mix types within the same
package scope:

* Within a `"type": "module"` package scope, Node.js can be instructed to
  interpret a particular file as CommonJS by naming it with a `.cjs` extension
  (since both `.js` and `.mjs` files are treated as ES modules within a
  `"module"` package scope).

* Within a `"type": "commonjs"` package scope, Node.js can be instructed to
  interpret a particular file as an ES module by naming it with an `.mjs`
  extension (since both `.js` and `.cjs` files are treated as CommonJS within a
  `"commonjs"` package scope).

### `--input-type` flag

Strings passed in as an argument to `--eval` or `--print` (or `-e` or `-p`), or
piped to `node` via `STDIN`, will be treated as ES modules when the
`--input-type=module` flag is set.

```bash
node --input-type=module --eval "import { sep } from 'path'; console.log(sep);"

echo "import { sep } from 'path'; console.log(sep);" | node --input-type=module
```

For completeness there is also `--input-type=commonjs`, for explicitly running
string input as CommonJS. This is the default behavior if `--input-type` is
unspecified.

## Packages

### Package entry points

In a package’s `package.json` file, two fields can define entry points for a
package: `"main"` and `"exports"`. The `"main"` field is supported in all
versions of Node.js, but its capabilities are limited: it only defines the main
entry point of the package.

The `"exports"` field provides an alternative to `"main"` where the package
main entry point can be defined while also encapsulating the package,
**preventing any other entry points besides those defined in `"exports"`**.
This encapsulation allows module authors to define a public interface for
their package.

If both `"exports"` and `"main"` are defined, the `"exports"` field takes
precedence over `"main"`. `"exports"` are not specific to ES modules or
CommonJS; `"main"` will be overridden by `"exports"` if it exists. As such
`"main"` cannot be used as a fallback for CommonJS but it can be used as a
fallback for legacy versions of Node.js that do not support the `"exports"`
field.

[Conditional exports][] can be used within `"exports"` to define different
package entry points per environment, including whether the package is
referenced via `require` or via `import`. For more information about supporting
both CommonJS and ES Modules in a single package please consult
[the dual CommonJS/ES module packages section][].

**Warning**: Introducing the `"exports"` field prevents consumers of a package
from using any entry points that are not defined, including the `package.json`
(e.g. `require('your-package/package.json')`. **This will likely be a breaking
change.**

To make the introduction of `"exports"` non-breaking, ensure that every
previously supported entry point is exported. It is best to explicitly specify
entry points so that the package’s public API is well-defined. For example,
a project that previous exported `main`, `lib`,
`feature`, and the `package.json` could use the following `package.exports`:

```json
{
  "name": "my-mod",
  "exports": {
    ".": "./lib/index.js",
    "./lib": "./lib/index.js",
    "./lib/index": "./lib/index.js",
    "./lib/index.js": "./lib/index.js",
    "./feature": "./feature/index.js",
    "./feature/index.js": "./feature/index.js",
    "./package.json": "./package.json"
  }
}
```

Alternatively a project could choose to export entire folders:

```json
{
  "name": "my-mod",
  "exports": {
    ".": "./lib/index.js",
    "./lib": "./lib/index.js",
    "./lib/": "./lib/",
    "./feature": "./feature/index.js",
    "./feature/": "./feature/",
    "./package.json": "./package.json"
  }
}
```

As a last resort, package encapsulation can be disabled entirely by creating an
export for the root of the package `"./": "./"`. This will expose every file in
the package at the cost of disabling the encapsulation and potential tooling
benefits this provides. As the ES Module loader in Node.js enforces the use of
[the full specifier path][], exporting the root rather than being explicit
about entry is less expressive than either of the prior examples. Not only
will encapsulation be lost but module consumers will be unable to
`import feature from 'my-mod/feature'` as they will need to provide the full
path `import feature from 'my-mod/feature/index.js`.

#### Main entry point export

To set the main entry point for a package, it is advisable to define both
`"exports"` and `"main"` in the package’s `package.json` file:

<!-- eslint-skip -->
```js
{
  "main": "./main.js",
  "exports": "./main.js"
}
```

The benefit of doing this is that when using the `"exports"` field all
subpaths of the package will no longer be available to importers under
`require('pkg/subpath.js')`, and instead they will get a new error,
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

This encapsulation of exports provides more reliable guarantees
about package interfaces for tools and when handling semver upgrades for a
package. It is not a strong encapsulation since a direct require of any
absolute subpath of the package such as
`require('/path/to/node_modules/pkg/subpath.js')` will still load `subpath.js`.

#### Subpath exports

When using the `"exports"` field, custom subpaths can be defined along
with the main entry point by treating the main entry point as the
`"."` subpath:

<!-- eslint-skip -->
```js
{
  "main": "./main.js",
  "exports": {
    ".": "./main.js",
    "./submodule": "./src/submodule.js"
  }
}
```

Now only the defined subpath in `"exports"` can be imported by a
consumer:

```js
import submodule from 'es-module-package/submodule';
// Loads ./node_modules/es-module-package/src/submodule.js
```

While other subpaths will error:

```js
import submodule from 'es-module-package/private-module.js';
// Throws ERR_PACKAGE_PATH_NOT_EXPORTED
```

Entire folders can also be mapped with package exports:

<!-- eslint-skip -->
```js
// ./node_modules/es-module-package/package.json
{
  "exports": {
    "./features/": "./src/features/"
  }
}
```

With the above, all modules within the `./src/features/` folder
are exposed deeply to `import` and `require`:

```js
import feature from 'es-module-package/features/x.js';
// Loads ./node_modules/es-module-package/src/features/x.js
```

When using folder mappings, ensure that you do want to expose every
module inside the subfolder. Any modules which are not public
should be moved to another folder to retain the encapsulation
benefits of exports.

#### Package exports fallbacks

For possible new specifier support in future, array fallbacks are
supported for all invalid specifiers:

<!-- eslint-skip -->
```js
{
  "exports": {
    "./submodule": ["not:valid", "./submodule.js"]
  }
}
```

Since `"not:valid"` is not a valid specifier, `"./submodule.js"` is used
instead as the fallback, as if it were the only target.

#### Exports sugar

If the `"."` export is the only export, the `"exports"` field provides sugar
for this case being the direct `"exports"` field value.

If the `"."` export has a fallback array or string value, then the `"exports"`
field can be set to this value directly.

<!-- eslint-skip -->
```js
{
  "exports": {
    ".": "./main.js"
  }
}
```

can be written:

<!-- eslint-skip -->
```js
{
  "exports": "./main.js"
}
```

#### Conditional exports

Conditional exports provide a way to map to different paths depending on
certain conditions. They are supported for both CommonJS and ES module imports.

For example, a package that wants to provide different ES module exports for
`require()` and `import` can be written:

<!-- eslint-skip -->
```js
// package.json
{
  "main": "./main-require.cjs",
  "exports": {
    "import": "./main-module.js",
    "require": "./main-require.cjs"
  },
  "type": "module"
}
```

Node.js supports the following conditions out of the box:

* `"import"` - matched when the package is loaded via `import` or
   `import()`. Can reference either an ES module or CommonJS file, as both
   `import` and `import()` can load either ES module or CommonJS sources.
   _Always matched when the `"require"` condition is not matched._
* `"require"` - matched when the package is loaded via `require()`.
   As `require()` only supports CommonJS, the referenced file must be CommonJS.
   _Always matched when the `"import"` condition is not matched._
* `"node"` - matched for any Node.js environment. Can be a CommonJS or ES
   module file. _This condition should always come after `"import"` or
   `"require"`._
* `"default"` - the generic fallback that will always match. Can be a CommonJS
   or ES module file. _This condition should always come last._

Within the `"exports"` object, key order is significant. During condition
matching, earlier entries have higher priority and take precedence over later
entries. _The general rule is that conditions should be from most specific to
least specific in object order_.

Other conditions such as `"browser"`, `"electron"`, `"deno"`, `"react-native"`,
etc. are unknown to, and thus ignored by Node.js. Runtimes or tools other than
Node.js may use them at their discretion. Further restrictions, definitions, or
guidance on condition names may occur in the future.

Using the `"import"` and `"require"` conditions can lead to some hazards,
which are further explained in [the dual CommonJS/ES module packages section][].

Conditional exports can also be extended to exports subpaths, for example:

<!-- eslint-skip -->
```js
{
  "main": "./main.js",
  "exports": {
    ".": "./main.js",
    "./feature": {
      "node": "./feature-node.js",
      "default": "./feature.js"
    }
  }
}
```

Defines a package where `require('pkg/feature')` and `import 'pkg/feature'`
could provide different implementations between Node.js and other JS
environments.

When using environment branches, always include a `"default"` condition where
possible. Providing a `"default"` condition ensures that any unknown JS
environments are able to use this universal implementation, which helps avoid
these JS environments from having to pretend to be existing environments in
order to support packages with conditional exports. For this reason, using
`"node"` and `"default"` condition branches is usually preferable to using
`"node"` and `"browser"` condition branches.

#### Nested conditions

In addition to direct mappings, Node.js also supports nested condition objects.

For example, to define a package that only has dual mode entry points for
use in Node.js but not the browser:

<!-- eslint-skip -->
```js
{
  "main": "./main.js",
  "exports": {
    "node": {
      "import": "./feature-node.mjs",
      "require": "./feature-node.cjs"
    },
    "default": "./feature.mjs",
  }
}
```

Conditions continue to be matched in order as with flat conditions. If
a nested conditional does not have any mapping it will continue checking
the remaining conditions of the parent condition. In this way nested
conditions behave analogously to nested JavaScript `if` statements.

#### Resolving user conditions

When running Node.js, custom user conditions can be added with the
`--conditions` or `-u` flag:

```bash
node --conditions=development main.js
```

which would then resolve the `"development"` condition in package imports and
exports, while resolving the existing `"node"`, `"default"`, `"import"`, and
`"require"` conditions as appropriate.

Any number of custom conditions can be set with repeat flags.

#### Self-referencing a package using its name

Within a package, the values defined in the package’s
`package.json` `"exports"` field can be referenced via the package’s name.
For example, assuming the `package.json` is:

```json
// package.json
{
  "name": "a-package",
  "exports": {
    ".": "./main.mjs",
    "./foo": "./foo.js"
  }
}
```

Then any module _in that package_ can reference an export in the package itself:

```js
// ./a-module.mjs
import { something } from 'a-package'; // Imports "something" from ./main.mjs.
```

Self-referencing is available only if `package.json` has `exports`, and will
allow importing only what that `exports` (in the `package.json`) allows.
So the code below, given the previous package, will generate a runtime error:

```js
// ./another-module.mjs

// Imports "another" from ./m.mjs. Fails because
// the "package.json" "exports" field
// does not provide an export named "./m.mjs".
import { another } from 'a-package/m.mjs';
```

Self-referencing is also available when using `require`, both in an ES module,
and in a CommonJS one. For example, this code will also work:

```js
// ./a-module.js
const { something } = require('a-package/foo'); // Loads from ./foo.js.
```

### Internal package imports

In addition to the `"exports"` field it is possible to define internal package
import maps that only apply to import specifiers from within the package itself.

Entries in the imports field must always start with `#` to ensure they are
clearly disambiguated from package specifiers.

For example, the imports field can be used to gain the benefits of conditional
exports for internal modules:

```json
// package.json
{
  "imports": {
    "#dep": {
      "node": "dep-node-native",
      "default": "./dep-polyfill.js"
    }
  },
  "dependencies": {
    "dep-node-native": "^1.0.0"
  }
}
```

where `import '#dep'` would now get the resolution of the external package
`dep-node-native` (including its exports in turn), and instead get the local
file `./dep-polyfill.js` relative to the package in other environments.

Unlike the exports field, import maps permit mapping to external packages
because this provides an important use case for conditional loading and also can
be done without the risk of cycles, unlike for exports.

Apart from the above, the resolution rules for the imports field are otherwise
analogous to the exports field.

### Dual CommonJS/ES module packages

Prior to the introduction of support for ES modules in Node.js, it was a common
pattern for package authors to include both CommonJS and ES module JavaScript
sources in their package, with `package.json` `"main"` specifying the CommonJS
entry point and `package.json` `"module"` specifying the ES module entry point.
This enabled Node.js to run the CommonJS entry point while build tools such as
bundlers used the ES module entry point, since Node.js ignored (and still
ignores) the top-level `"module"` field.

Node.js can now run ES module entry points, and a package can contain both
CommonJS and ES module entry points (either via separate specifiers such as
`'pkg'` and `'pkg/es-module'`, or both at the same specifier via [Conditional
exports][]). Unlike in the scenario where `"module"` is only used by bundlers,
or ES module files are transpiled into CommonJS on the fly before evaluation by
Node.js, the files referenced by the ES module entry point are evaluated as ES
modules.

#### Dual package hazard

When an application is using a package that provides both CommonJS and ES module
sources, there is a risk of certain bugs if both versions of the package get
loaded. This potential comes from the fact that the `pkgInstance` created by
`const pkgInstance = require('pkg')` is not the same as the `pkgInstance`
created by `import pkgInstance from 'pkg'` (or an alternative main path like
`'pkg/module'`). This is the “dual package hazard,” where two versions of the
same package can be loaded within the same runtime environment. While it is
unlikely that an application or package would intentionally load both versions
directly, it is common for an application to load one version while a dependency
of the application loads the other version. This hazard can happen because
Node.js supports intermixing CommonJS and ES modules, and can lead to unexpected
behavior.

If the package main export is a constructor, an `instanceof` comparison of
instances created by the two versions returns `false`, and if the export is an
object, properties added to one (like `pkgInstance.foo = 3`) are not present on
the other. This differs from how `import` and `require` statements work in
all-CommonJS or all-ES module environments, respectively, and therefore is
surprising to users. It also differs from the behavior users are familiar with
when using transpilation via tools like [Babel][] or [`esm`][].

#### Writing dual packages while avoiding or minimizing hazards

First, the hazard described in the previous section occurs when a package
contains both CommonJS and ES module sources and both sources are provided for
use in Node.js, either via separate main entry points or exported paths. A
package could instead be written where any version of Node.js receives only
CommonJS sources, and any separate ES module sources the package may contain
could be intended only for other environments such as browsers. Such a package
would be usable by any version of Node.js, since `import` can refer to CommonJS
files; but it would not provide any of the advantages of using ES module syntax.

A package could also switch from CommonJS to ES module syntax in a breaking
change version bump. This has the disadvantage that the newest version
of the package would only be usable in ES module-supporting versions of Node.js.

Every pattern has tradeoffs, but there are two broad approaches that satisfy the
following conditions:

1. The package is usable via both `require` and `import`.
1. The package is usable in both current Node.js and older versions of Node.js
   that lack support for ES modules.
1. The package main entry point, e.g. `'pkg'` can be used by both `require` to
   resolve to a CommonJS file and by `import` to resolve to an ES module file.
   (And likewise for exported paths, e.g. `'pkg/feature'`.)
1. The package provides named exports, e.g. `import { name } from 'pkg'` rather
   than `import pkg from 'pkg'; pkg.name`.
1. The package is potentially usable in other ES module environments such as
   browsers.
1. The hazards described in the previous section are avoided or minimized.

##### Approach #1: Use an ES module wrapper

Write the package in CommonJS or transpile ES module sources into CommonJS, and
create an ES module wrapper file that defines the named exports. Using
[Conditional exports][], the ES module wrapper is used for `import` and the
CommonJS entry point for `require`.

<!-- eslint-skip -->
```js
// ./node_modules/pkg/package.json
{
  "type": "module",
  "main": "./index.cjs",
  "exports": {
    "import": "./wrapper.mjs",
    "require": "./index.cjs"
  }
}
```

The preceding example uses explicit extensions `.mjs` and `.cjs`.
If your files use the `.js` extension, `"type": "module"` will cause such files
to be treated as ES modules, just as `"type": "commonjs"` would cause them
to be treated as CommonJS.
See [Enabling](#esm_enabling).

```js
// ./node_modules/pkg/index.cjs
exports.name = 'value';
```

```js
// ./node_modules/pkg/wrapper.mjs
import cjsModule from './index.cjs';
export const name = cjsModule.name;
```

In this example, the `name` from `import { name } from 'pkg'` is the same
singleton as the `name` from `const { name } = require('pkg')`. Therefore `===`
returns `true` when comparing the two `name`s and the divergent specifier hazard
is avoided.

If the module is not simply a list of named exports, but rather contains a
unique function or object export like `module.exports = function () { ... }`,
or if support in the wrapper for the `import pkg from 'pkg'` pattern is desired,
then the wrapper would instead be written to export the default optionally
along with any named exports as well:

```js
import cjsModule from './index.cjs';
export const name = cjsModule.name;
export default cjsModule;
```

This approach is appropriate for any of the following use cases:
* The package is currently written in CommonJS and the author would prefer not
  to refactor it into ES module syntax, but wishes to provide named exports for
  ES module consumers.
* The package has other packages that depend on it, and the end user might
  install both this package and those other packages. For example a `utilities`
  package is used directly in an application, and a `utilities-plus` package
  adds a few more functions to `utilities`. Because the wrapper exports
  underlying CommonJS files, it doesn’t matter if `utilities-plus` is written in
  CommonJS or ES module syntax; it will work either way.
* The package stores internal state, and the package author would prefer not to
  refactor the package to isolate its state management. See the next section.

A variant of this approach not requiring conditional exports for consumers could
be to add an export, e.g. `"./module"`, to point to an all-ES module-syntax
version of the package. This could be used via `import 'pkg/module'` by users
who are certain that the CommonJS version will not be loaded anywhere in the
application, such as by dependencies; or if the CommonJS version can be loaded
but doesn’t affect the ES module version (for example, because the package is
stateless):

<!-- eslint-skip -->
```js
// ./node_modules/pkg/package.json
{
  "type": "module",
  "main": "./index.cjs",
  "exports": {
    ".": "./index.cjs",
    "./module": "./wrapper.mjs"
  }
}
```

##### Approach #2: Isolate state

A `package.json` file can define the separate CommonJS and ES module entry
points directly:

<!-- eslint-skip -->
```js
// ./node_modules/pkg/package.json
{
  "type": "module",
  "main": "./index.cjs",
  "exports": {
    "import": "./index.mjs",
    "require": "./index.cjs"
  }
}
```

This can be done if both the CommonJS and ES module versions of the package are
equivalent, for example because one is the transpiled output of the other; and
the package’s management of state is carefully isolated (or the package is
stateless).

The reason that state is an issue is because both the CommonJS and ES module
versions of the package may get used within an application; for example, the
user’s application code could `import` the ES module version while a dependency
`require`s the CommonJS version. If that were to occur, two copies of the
package would be loaded in memory and therefore two separate states would be
present. This would likely cause hard-to-troubleshoot bugs.

Aside from writing a stateless package (if JavaScript’s `Math` were a package,
for example, it would be stateless as all of its methods are static), there are
some ways to isolate state so that it’s shared between the potentially loaded
CommonJS and ES module instances of the package:

1. If possible, contain all state within an instantiated object. JavaScript’s
   `Date`, for example, needs to be instantiated to contain state; if it were a
   package, it would be used like this:

    ```js
    import Date from 'date';
    const someDate = new Date();
    // someDate contains state; Date does not
    ```

   The `new` keyword isn’t required; a package’s function can return a new
   object, or modify a passed-in object, to keep the state external to the
   package.

1. Isolate the state in one or more CommonJS files that are shared between the
   CommonJS and ES module versions of the package. For example, if the CommonJS
   and ES module entry points are `index.cjs` and `index.mjs`, respectively:

    ```js
    // ./node_modules/pkg/index.cjs
    const state = require('./state.cjs');
    module.exports.state = state;
    ```

    ```js
    // ./node_modules/pkg/index.mjs
    import state from './state.cjs';
    export {
      state
    };
    ```

   Even if `pkg` is used via both `require` and `import` in an application (for
   example, via `import` in application code and via `require` by a dependency)
   each reference of `pkg` will contain the same state; and modifying that
   state from either module system will apply to both.

Any plugins that attach to the package’s singleton would need to separately
attach to both the CommonJS and ES module singletons.

This approach is appropriate for any of the following use cases:
* The package is currently written in ES module syntax and the package author
  wants that version to be used wherever such syntax is supported.
* The package is stateless or its state can be isolated without too much
  difficulty.
* The package is unlikely to have other public packages that depend on it, or if
  it does, the package is stateless or has state that need not be shared between
  dependencies or with the overall application.

Even with isolated state, there is still the cost of possible extra code
execution between the CommonJS and ES module versions of a package.

As with the previous approach, a variant of this approach not requiring
conditional exports for consumers could be to add an export, e.g.
`"./module"`, to point to an all-ES module-syntax version of the package:

<!-- eslint-skip -->
```js
// ./node_modules/pkg/package.json
{
  "type": "module",
  "main": "./index.cjs",
  "exports": {
    ".": "./index.cjs",
    "./module": "./index.mjs"
  }
}
```

## `import` Specifiers

### Terminology

The _specifier_ of an `import` statement is the string after the `from` keyword,
e.g. `'path'` in `import { sep } from 'path'`. Specifiers are also used in
`export from` statements, and as the argument to an `import()` expression.

There are four types of specifiers:

* _Bare specifiers_ like `'some-package'`. They refer to an entry point of a
  package by the package name.

* _Deep import specifiers_ like `'some-package/lib/shuffle.mjs'`. They refer to
  a path within a package prefixed by the package name.

* _Relative specifiers_ like `'./startup.js'` or `'../config.mjs'`. They refer
  to a path relative to the location of the importing file.

* _Absolute specifiers_ like `'file:///opt/nodejs/config.js'`. They refer
  directly and explicitly to a full path.

Bare specifiers, and the bare specifier portion of deep import specifiers, are
strings; but everything else in a specifier is a URL.

Only `file:` and `data:` URLs are supported. A specifier like
`'https://example.com/app.js'` may be supported by browsers but it is not
supported in Node.js.

Specifiers may not begin with `/` or `//`. These are reserved for potential
future use. The root of the current volume may be referenced via `file:///`.

#### `data:` Imports

<!-- YAML
added: v12.10.0
-->

[`data:` URLs][] are supported for importing with the following MIME types:

* `text/javascript` for ES Modules
* `application/json` for JSON
* `application/wasm` for WASM.

`data:` URLs only resolve [_Bare specifiers_][Terminology] for builtin modules
and [_Absolute specifiers_][Terminology]. Resolving
[_Relative specifiers_][Terminology] will not work because `data:` is not a
[special scheme][]. For example, attempting to load `./foo`
from `data:text/javascript,import "./foo";` will fail to resolve since there
is no concept of relative resolution for `data:` URLs. An example of a `data:`
URLs being used is:

```js
import 'data:text/javascript,console.log("hello!");';
import _ from 'data:application/json,"world!"';
```

## `import.meta`

* {Object}

The `import.meta` metaproperty is an `Object` that contains the following
property:

* `url` {string} The absolute `file:` URL of the module.

## Differences between ES modules and CommonJS

### Mandatory file extensions

A file extension must be provided when using the `import` keyword. Directory
indexes (e.g. `'./startup/index.js'`) must also be fully specified.

This behavior matches how `import` behaves in browser environments, assuming a
typically configured server.

### No `NODE_PATH`

`NODE_PATH` is not part of resolving `import` specifiers. Please use symlinks
if this behavior is desired.

### No `require`, `exports`, `module.exports`, `__filename`, `__dirname`

These CommonJS variables are not available in ES modules.

`require` can be imported into an ES module using [`module.createRequire()`][].

Equivalents of `__filename` and `__dirname` can be created inside of each file
via [`import.meta.url`][].

```js
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### No `require.resolve`

Former use cases relying on `require.resolve` to determine the resolved path
of a module can be supported via `import.meta.resolve`, which is experimental
and supported via the `--experimental-import-meta-resolve` flag:

```js
(async () => {
  const dependencyAsset = await import.meta.resolve('component-lib/asset.css');
})();
```

`import.meta.resolve` also accepts a second argument which is the parent module
from which to resolve from:

```js
(async () => {
  // Equivalent to import.meta.resolve('./dep')
  await import.meta.resolve('./dep', import.meta.url);
})();
```

This function is asynchronous since the ES module resolver in Node.js is
asynchronous. With the introduction of [Top-Level Await][], these use cases
will be easier as they won't require an async function wrapper.

### No `require.extensions`

`require.extensions` is not used by `import`. The expectation is that loader
hooks can provide this workflow in the future.

### No `require.cache`

`require.cache` is not used by `import`. It has a separate cache.

### URL-based paths

ES modules are resolved and cached based upon
[URL](https://url.spec.whatwg.org/) semantics. This means that files containing
special characters such as `#` and `?` need to be escaped.

Modules will be loaded multiple times if the `import` specifier used to resolve
them have a different query or fragment.

```js
import './foo.mjs?query=1'; // loads ./foo.mjs with query of "?query=1"
import './foo.mjs?query=2'; // loads ./foo.mjs with query of "?query=2"
```

For now, only modules using the `file:` protocol can be loaded.

## Interoperability with CommonJS

### `require`

`require` always treats the files it references as CommonJS. This applies
whether `require` is used the traditional way within a CommonJS environment, or
in an ES module environment using [`module.createRequire()`][].

To include an ES module into CommonJS, use [`import()`][].

### `import` statements

An `import` statement can reference an ES module or a CommonJS module. Other
file types such as JSON or native modules are not supported. For those, use
[`module.createRequire()`][].

`import` statements are permitted only in ES modules. For similar functionality
in CommonJS, see [`import()`][].

The _specifier_ of an `import` statement (the string after the `from` keyword)
can either be an URL-style relative path like `'./file.mjs'` or a package name
like `'fs'`.

Like in CommonJS, files within packages can be accessed by appending a path to
the package name; unless the package’s `package.json` contains an `"exports"`
field, in which case files within packages need to be accessed via the path
defined in `"exports"`.

```js
import { sin, cos } from 'geometry/trigonometry-functions.mjs';
```

Only the “default export” is supported for CommonJS files or packages:

<!-- eslint-disable no-duplicate-imports -->
```js
import packageMain from 'commonjs-package'; // Works

import { method } from 'commonjs-package'; // Errors
```

It is also possible to
[import an ES or CommonJS module for its side effects only][].

### `import()` expressions

[Dynamic `import()`][] is supported in both CommonJS and ES modules. It can be
used to include ES module files from CommonJS code.

## CommonJS, JSON, and native modules

CommonJS, JSON, and native modules can be used with
[`module.createRequire()`][].

```js
// cjs.cjs
module.exports = 'cjs';

// esm.mjs
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const cjs = require('./cjs.cjs');
cjs === 'cjs'; // true
```

## Builtin modules

Builtin modules will provide named exports of their public API. A
default export is also provided which is the value of the CommonJS exports.
The default export can be used for, among other things, modifying the named
exports. Named exports of builtin modules are updated only by calling
[`module.syncBuiltinESMExports()`][].

```js
import EventEmitter from 'events';
const e = new EventEmitter();
```

```js
import { readFile } from 'fs';
readFile('./foo.txt', (err, source) => {
  if (err) {
    console.error(err);
  } else {
    console.log(source);
  }
});
```

```js
import fs, { readFileSync } from 'fs';
import { syncBuiltinESMExports } from 'module';

fs.readFileSync = () => Buffer.from('Hello, ESM');
syncBuiltinESMExports();

fs.readFileSync === readFileSync;
```

## Experimental JSON modules

Currently importing JSON modules are only supported in the `commonjs` mode
and are loaded using the CJS loader. [WHATWG JSON modules specification][] are
still being standardized, and are experimentally supported by including the
additional flag `--experimental-json-modules` when running Node.js.

When the `--experimental-json-modules` flag is included both the
`commonjs` and `module` mode will use the new experimental JSON
loader. The imported JSON only exposes a `default`, there is no
support for named exports. A cache entry is created in the CommonJS
cache, to avoid duplication. The same object will be returned in
CommonJS if the JSON module has already been imported from the
same path.

Assuming an `index.mjs` with

<!-- eslint-skip -->
```js
import packageConfig from './package.json';
```

The `--experimental-json-modules` flag is needed for the module
to work.

```bash
node index.mjs # fails
node --experimental-json-modules index.mjs # works
```

## Experimental Wasm modules

Importing Web Assembly modules is supported under the
`--experimental-wasm-modules` flag, allowing any `.wasm` files to be
imported as normal modules while also supporting their module imports.

This integration is in line with the
[ES Module Integration Proposal for Web Assembly][].

For example, an `index.mjs` containing:

```js
import * as M from './module.wasm';
console.log(M);
```

executed under:

```bash
node --experimental-wasm-modules index.mjs
```

would provide the exports interface for the instantiation of `module.wasm`.

## Experimental loaders

**Note: This API is currently being redesigned and will still change.**

<!-- type=misc -->

To customize the default module resolution, loader hooks can optionally be
provided via a `--experimental-loader ./loader-name.mjs` argument to Node.js.

When hooks are used they only apply to ES module loading and not to any
CommonJS modules loaded.

### Hooks

#### <code>resolve</code> hook

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

The `resolve` hook returns the resolved file URL for a given module specifier
and parent URL. The module specifier is the string in an `import` statement or
`import()` expression, and the parent URL is the URL of the module that imported
this one, or `undefined` if this is the main entry point for the application.

The `conditions` property on the `context` is an array of conditions for
[Conditional exports][] that apply to this resolution request. They can be used
for looking up conditional mappings elsewhere or to modify the list when calling
the default resolution logic.

The current [package exports conditions][Conditional Exports] will always be in
the `context.conditions` array passed into the hook. To guarantee _default
Node.js module specifier resolution behavior_ when calling `defaultResolve`, the
`context.conditions` array passed to it _must_ include _all_ elements of the
`context.conditions` array originally passed into the `resolve` hook.

```js
/**
 * @param {string} specifier
 * @param {{
 *   parentURL: !(string | undefined),
 *   conditions: !(Array<string>),
 * }} context
 * @param {Function} defaultResolve
 * @returns {!(Promise<{ url: string }>)}
 */
export async function resolve(specifier, context, defaultResolve) {
  const { parentURL = null } = context;
  if (Math.random() > 0.5) { // Some condition.
    // For some or all specifiers, do some custom logic for resolving.
    // Always return an object of the form {url: <string>}.
    return {
      url: parentURL ?
        new URL(specifier, parentURL).href :
        new URL(specifier).href,
    };
  }
  if (Math.random() < 0.5) { // Another condition.
    // When calling `defaultResolve`, the arguments can be modified. In this
    // case it's adding another value for matching conditional exports.
    return defaultResolve(specifier, {
      ...context,
      conditions: [...context.conditions, 'another-condition'],
    });
  }
  // Defer to Node.js for all other specifiers.
  return defaultResolve(specifier, context, defaultResolve);
}
```

#### <code>getFormat</code> hook

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

The `getFormat` hook provides a way to define a custom method of determining how
a URL should be interpreted. The `format` returned also affects what the
acceptable forms of source values are for a module when parsing. This can be one
of the following:

| `format` | Description | Acceptable Types For `source` Returned by `getSource` or `transformSource` |
| --- | --- | --- |
| `'builtin'` | Load a Node.js builtin module | Not applicable |
| `'commonjs'` | Load a Node.js CommonJS module | Not applicable |
| `'dynamic'` | Use a [dynamic instantiate hook][] | Not applicable |
| `'json'` | Load a JSON file | { [ArrayBuffer][], [string][], [TypedArray][] } |
| `'module'` | Load an ES module | { [ArrayBuffer][], [string][], [TypedArray][] } |
| `'wasm'` | Load a WebAssembly module | { [ArrayBuffer][], [string][], [TypedArray][] } |

Note: These types all correspond to classes defined in ECMAScript.

* The specific [ArrayBuffer][] object is a [SharedArrayBuffer][].
* The specific [string][] object is not the class constructor, but an instance.
* The specific [TypedArray][] object is a [Uint8Array][].

Note: If the source value of a text-based format (i.e., `'json'`, `'module'`) is
not a string, it will be converted to a string using [`util.TextDecoder`][].

```js
/**
 * @param {string} url
 * @param {Object} context (currently empty)
 * @param {Function} defaultGetFormat
 * @returns {Promise<{ format: string }>}
 */
export async function getFormat(url, context, defaultGetFormat) {
  if (Math.random() > 0.5) { // Some condition.
    // For some or all URLs, do some custom logic for determining format.
    // Always return an object of the form {format: <string>}, where the
    // format is one of the strings in the preceding table.
    return {
      format: 'module',
    };
  }
  // Defer to Node.js for all other URLs.
  return defaultGetFormat(url, context, defaultGetFormat);
}
```

#### <code>getSource</code> hook

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

The `getSource` hook provides a way to define a custom method for retrieving
the source code of an ES module specifier. This would allow a loader to
potentially avoid reading files from disk.

```js
/**
 * @param {string} url
 * @param {{ format: string }} context
 * @param {Function} defaultGetSource
 * @returns {Promise<{ source: !(SharedArrayBuffer | string | Uint8Array) }>}
 */
export async function getSource(url, context, defaultGetSource) {
  const { format } = context;
  if (Math.random() > 0.5) { // Some condition.
    // For some or all URLs, do some custom logic for retrieving the source.
    // Always return an object of the form {source: <string|buffer>}.
    return {
      source: '...',
    };
  }
  // Defer to Node.js for all other URLs.
  return defaultGetSource(url, context, defaultGetSource);
}
```

#### <code>transformSource</code> hook

```console
NODE_OPTIONS='--experimental-loader ./custom-loader.mjs' node x.js
```

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

The `transformSource` hook provides a way to modify the source code of a loaded
ES module file after the source string has been loaded but before Node.js has
done anything with it.

If this hook is used to convert unknown-to-Node.js file types into executable
JavaScript, a resolve hook is also necessary in order to register any
unknown-to-Node.js file extensions. See the [transpiler loader example][] below.

```js
/**
 * @param {!(SharedArrayBuffer | string | Uint8Array)} source
 * @param {{
 *   url: string,
 *   format: string,
 * }} context
 * @param {Function} defaultTransformSource
 * @returns {Promise<{ source: !(SharedArrayBuffer | string | Uint8Array) }>}
 */
export async function transformSource(source, context, defaultTransformSource) {
  const { url, format } = context;
  if (Math.random() > 0.5) { // Some condition.
    // For some or all URLs, do some custom logic for modifying the source.
    // Always return an object of the form {source: <string|buffer>}.
    return {
      source: '...',
    };
  }
  // Defer to Node.js for all other sources.
  return defaultTransformSource(source, context, defaultTransformSource);
}
```

#### <code>getGlobalPreloadCode</code> hook

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

Sometimes it can be necessary to run some code inside of the same global scope
that the application will run in. This hook allows to return a string that will
be ran as sloppy-mode script on startup.

Similar to how CommonJS wrappers work, the code runs in an implicit function
scope. The only argument is a `require`-like function that can be used to load
builtins like "fs": `getBuiltin(request: string)`.

If the code needs more advanced `require` features, it will have to construct
its own `require` using  `module.createRequire()`.

```js
/**
 * @returns {string} Code to run before application startup
 */
export function getGlobalPreloadCode() {
  return `\
globalThis.someInjectedProperty = 42;
console.log('I just set some globals!');

const { createRequire } = getBuiltin('module');

const require = createRequire(process.cwd() + '/<preload>');
// [...]
`;
}
```

#### <code>dynamicInstantiate</code> hook

> Note: The loaders API is being redesigned. This hook may disappear or its
> signature may change. Do not rely on the API described below.

To create a custom dynamic module that doesn't correspond to one of the
existing `format` interpretations, the `dynamicInstantiate` hook can be used.
This hook is called only for modules that return `format: 'dynamic'` from
the [`getFormat` hook][].

```js
/**
 * @param {string} url
 * @returns {object} response
 * @returns {array} response.exports
 * @returns {function} response.execute
 */
export async function dynamicInstantiate(url) {
  return {
    exports: ['customExportName'],
    execute: (exports) => {
      // Get and set functions provided for pre-allocated export names
      exports.customExportName.set('value');
    }
  };
}
```

With the list of module exports provided upfront, the `execute` function will
then be called at the exact point of module evaluation order for that module
in the import tree.

### Examples

The various loader hooks can be used together to accomplish wide-ranging
customizations of Node.js’ code loading and evaluation behaviors.

#### HTTPS loader

In current Node.js, specifiers starting with `https://` are unsupported. The
loader below registers hooks to enable rudimentary support for such specifiers.
While this may seem like a significant improvement to Node.js core
functionality, there are substantial downsides to actually using this loader:
performance is much slower than loading files from disk, there is no caching,
and there is no security.

```js
// https-loader.mjs
import { get } from 'https';

export function resolve(specifier, context, defaultResolve) {
  const { parentURL = null } = context;

  // Normally Node.js would error on specifiers starting with 'https://', so
  // this hook intercepts them and converts them into absolute URLs to be
  // passed along to the later hooks below.
  if (specifier.startsWith('https://')) {
    return {
      url: specifier
    };
  } else if (parentURL && parentURL.startsWith('https://')) {
    return {
      url: new URL(specifier, parentURL).href
    };
  }

  // Let Node.js handle all other specifiers.
  return defaultResolve(specifier, context, defaultResolve);
}

export function getFormat(url, context, defaultGetFormat) {
  // This loader assumes all network-provided JavaScript is ES module code.
  if (url.startsWith('https://')) {
    return {
      format: 'module'
    };
  }

  // Let Node.js handle all other URLs.
  return defaultGetFormat(url, context, defaultGetFormat);
}

export function getSource(url, context, defaultGetSource) {
  // For JavaScript to be loaded over the network, we need to fetch and
  // return it.
  if (url.startsWith('https://')) {
    return new Promise((resolve, reject) => {
      get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ source: data }));
      }).on('error', (err) => reject(err));
    });
  }

  // Let Node.js handle all other URLs.
  return defaultGetSource(url, context, defaultGetSource);
}
```

```js
// main.mjs
import { VERSION } from 'https://coffeescript.org/browser-compiler-modern/coffeescript.js';

console.log(VERSION);
```

With this loader, running:

```bash
node --experimental-loader ./https-loader.mjs ./main.mjs
```

Will print the current version of CoffeeScript per the module at the URL in
`main.mjs`.

#### Transpiler loader

Sources that are in formats Node.js doesn’t understand can be converted into
JavaScript using the [`transformSource` hook][]. Before that hook gets called,
however, other hooks need to tell Node.js not to throw an error on unknown file
types; and to tell Node.js how to load this new file type.

This is less performant than transpiling source files before running
Node.js; a transpiler loader should only be used for development and testing
purposes.

```js
// coffeescript-loader.mjs
import { URL, pathToFileURL } from 'url';
import CoffeeScript from 'coffeescript';

const baseURL = pathToFileURL(`${process.cwd()}/`).href;

// CoffeeScript files end in .coffee, .litcoffee or .coffee.md.
const extensionsRegex = /\.coffee$|\.litcoffee$|\.coffee\.md$/;

export function resolve(specifier, context, defaultResolve) {
  const { parentURL = baseURL } = context;

  // Node.js normally errors on unknown file extensions, so return a URL for
  // specifiers ending in the CoffeeScript file extensions.
  if (extensionsRegex.test(specifier)) {
    return {
      url: new URL(specifier, parentURL).href
    };
  }

  // Let Node.js handle all other specifiers.
  return defaultResolve(specifier, context, defaultResolve);
}

export function getFormat(url, context, defaultGetFormat) {
  // Now that we patched resolve to let CoffeeScript URLs through, we need to
  // tell Node.js what format such URLs should be interpreted as. For the
  // purposes of this loader, all CoffeeScript URLs are ES modules.
  if (extensionsRegex.test(url)) {
    return {
      format: 'module'
    };
  }

  // Let Node.js handle all other URLs.
  return defaultGetFormat(url, context, defaultGetFormat);
}

export function transformSource(source, context, defaultTransformSource) {
  const { url, format } = context;

  if (extensionsRegex.test(url)) {
    return {
      source: CoffeeScript.compile(source, { bare: true })
    };
  }

  // Let Node.js handle all other sources.
  return defaultTransformSource(source, context, defaultTransformSource);
}
```

```coffee
# main.coffee
import { scream } from './scream.coffee'
console.log scream 'hello, world'

import { version } from 'process'
console.log "Brought to you by Node.js version #{version}"
```

```coffee
# scream.coffee
export scream = (str) -> str.toUpperCase()
```

With this loader, running:

```console
node --experimental-loader ./coffeescript-loader.mjs main.coffee
```

Will cause `main.coffee` to be turned into JavaScript after its source code is
loaded from disk but before Node.js executes it; and so on for any `.coffee`,
`.litcoffee` or `.coffee.md` files referenced via `import` statements of any
loaded file.

## Resolution algorithm

### Features

The resolver has the following properties:

* FileURL-based resolution as is used by ES modules
* Support for builtin module loading
* Relative and absolute URL resolution
* No default extensions
* No folder mains
* Bare specifier package resolution lookup through node_modules

### Resolver algorithm

The algorithm to load an ES module specifier is given through the
**ESM_RESOLVE** method below. It returns the resolved URL for a
module specifier relative to a parentURL.

The algorithm to determine the module format of a resolved URL is
provided by **ESM_FORMAT**, which returns the unique module
format for any file. The _"module"_ format is returned for an ECMAScript
Module, while the _"commonjs"_ format is used to indicate loading through the
legacy CommonJS loader. Additional formats such as _"addon"_ can be extended in
future updates.

In the following algorithms, all subroutine errors are propagated as errors
of these top-level routines unless stated otherwise.

_defaultConditions_ is the conditional environment name array,
`["node", "import"]`.

The resolver can throw the following errors:
* _Invalid Module Specifier_: Module specifier is an invalid URL, package name
  or package subpath specifier.
* _Invalid Package Configuration_: package.json configuration is invalid or
  contains an invalid configuration.
* _Invalid Package Target_: Package exports or imports define a target module
  for the package that is an invalid type or string target.
* _Package Path Not Exported_: Package exports do not define or permit a target
  subpath in the package for the given module.
* _Package Import Not Defined_: Package imports do not define the specifier.
* _Module Not Found_: The package or module requested does not exist.

<details>
<summary>Resolver algorithm specification</summary>

**ESM_RESOLVE**(_specifier_, _parentURL_)

> 1. Let _resolved_ be **undefined**.
> 1. If _specifier_ is a valid URL, then
>    1. Set _resolved_ to the result of parsing and reserializing
>       _specifier_ as a URL.
> 1. Otherwise, if _specifier_ starts with _"/"_, _"./"_ or _"../"_, then
>    1. Set _resolved_ to the URL resolution of _specifier_ relative to
>       _parentURL_.
> 1. Otherwise, if _specifier_ starts with _"#"_, then
>    1. Set _resolved_ to the destructured value of the result of
>       **PACKAGE_IMPORTS_RESOLVE**(_specifier_, _parentURL_,
>       _defaultConditions_).
> 1. Otherwise,
>    1. Note: _specifier_ is now a bare specifier.
>    1. Set _resolved_ the result of
>       **PACKAGE_RESOLVE**(_specifier_, _parentURL_).
> 1. If _resolved_ contains any percent encodings of _"/"_ or _"\\"_ (_"%2f"_
>    and _"%5C"_ respectively), then
>    1. Throw an _Invalid Module Specifier_ error.
> 1. If the file at _resolved_ is a directory, then
>    1. Throw an _Unsupported Directory Import_ error.
> 1. If the file at _resolved_ does not exist, then
>    1. Throw a _Module Not Found_ error.
> 1. Set _resolved_ to the real path of _resolved_.
> 1. Let _format_ be the result of **ESM_FORMAT**(_resolved_).
> 1. Load _resolved_ as module format, _format_.
> 1. Return _resolved_.

**PACKAGE_RESOLVE**(_packageSpecifier_, _parentURL_)

> 1. Let _packageName_ be **undefined**.
> 1. If _packageSpecifier_ is an empty string, then
>    1. Throw an _Invalid Module Specifier_ error.
> 1. If _packageSpecifier_ does not start with _"@"_, then
>    1. Set _packageName_ to the substring of _packageSpecifier_ until the first
>       _"/"_ separator or the end of the string.
> 1. Otherwise,
>    1. If _packageSpecifier_ does not contain a _"/"_ separator, then
>       1. Throw an _Invalid Module Specifier_ error.
>    1. Set _packageName_ to the substring of _packageSpecifier_
>       until the second _"/"_ separator or the end of the string.
> 1. If _packageName_ starts with _"."_ or contains _"\\"_ or _"%"_, then
>    1. Throw an _Invalid Module Specifier_ error.
> 1. Let _packageSubpath_ be _"."_ concatenated with the substring of
>       _packageSpecifier_ from the position at the length of _packageName_.
> 1. Let _selfUrl_ be the result of
>    **PACKAGE_SELF_RESOLVE**(_packageName_, _packageSubpath_, _parentURL_).
> 1. If _selfUrl_ is not **undefined**, return _selfUrl_.
> 1. If _packageSubpath_ is _"."_ and _packageName_ is a Node.js builtin
>    module, then
>    1. Return the string _"nodejs:"_ concatenated with _packageSpecifier_.
> 1. While _parentURL_ is not the file system root,
>    1. Let _packageURL_ be the URL resolution of _"node_modules/"_
>       concatenated with _packageSpecifier_, relative to _parentURL_.
>    1. Set _parentURL_ to the parent folder URL of _parentURL_.
>    1. If the folder at _packageURL_ does not exist, then
>       1. Set _parentURL_ to the parent URL path of _parentURL_.
>       1. Continue the next loop iteration.
>    1. Let _pjson_ be the result of **READ_PACKAGE_JSON**(_packageURL_).
>    1. If _pjson_ is not **null** and _pjson_._exports_ is not **null** or
>       **undefined**, then
>       1. Let _exports_ be _pjson.exports_.
>       1. Return the _resolved_ destructured value of the result of
>          **PACKAGE_EXPORTS_RESOLVE**(_packageURL_, _packageSubpath_,
>           _pjson.exports_, _defaultConditions_).
>    1. Otherwise, if _packageSubpath_ is equal to _"."_, then
>       1. Return the result applying the legacy **LOAD_AS_DIRECTORY**
>          CommonJS resolver to _packageURL_, throwing a _Module Not Found_
>          error for no resolution.
>    1. Otherwise,
>       1. Return the URL resolution of _packageSubpath_ in _packageURL_.
> 1. Throw a _Module Not Found_ error.

**PACKAGE_SELF_RESOLVE**(_packageName_, _packageSubpath_, _parentURL_)

> 1. Let _packageURL_ be the result of **READ_PACKAGE_SCOPE**(_parentURL_).
> 1. If _packageURL_ is **null**, then
>    1. Return **undefined**.
> 1. Let _pjson_ be the result of **READ_PACKAGE_JSON**(_packageURL_).
> 1. If _pjson_ is **null** or if _pjson_._exports_ is **null** or
>    **undefined**, then
>    1. Return **undefined**.
> 1. If _pjson.name_ is equal to _packageName_, then
>    1. Return the _resolved_ destructured value of the result of
>       **PACKAGE_EXPORTS_RESOLVE**(_packageURL_, _subpath_, _pjson.exports_,
>       _defaultConditions_).
> 1. Otherwise, return **undefined**.

**PACKAGE_EXPORTS_RESOLVE**(_packageURL_, _subpath_, _exports_, _conditions_)

> 1. If _exports_ is an Object with both a key starting with _"."_ and a key not
>    starting with _"."_, throw an _Invalid Package Configuration_ error.
> 1. If _subpath_ is equal to _"."_, then
>    1. Let _mainExport_ be **undefined**.
>    1. If _exports_ is a String or Array, or an Object containing no keys
>       starting with _"."_, then
>       1. Set _mainExport_ to _exports_.
>    1. Otherwise if _exports_ is an Object containing a _"."_ property, then
>       1. Set _mainExport_ to _exports_\[_"."_\].
>    1. If _mainExport_ is not **undefined**, then
>       1. Let _resolved_ be the result of **PACKAGE_TARGET_RESOLVE**(
>          _packageURL_, _mainExport_, _""_, **false**, _conditions_).
>       1. If _resolved_ is not **null** or **undefined**, then
>          1. Return _resolved_.
> 1. Otherwise, if _exports_ is an Object and all keys of _exports_ start with
>    _"."_, then
>    1. Let _matchKey_ be the string _"./"_ concatenated with _subpath_.
>    1. Let _resolvedMatch_ be result of **PACKAGE_IMPORTS_EXPORTS_RESOLVE**(
>       _matchKey_, _exports_, _packageURL_, **false**, _conditions_).
>    1. If _resolvedMatch_._resolve_ is not **null** or **undefined**, then
>       1. Return _resolvedMatch_.
> 1. Throw a _Package Path Not Exported_ error.

**PACKAGE_IMPORTS_RESOLVE**(_specifier_, _parentURL_, _conditions_)

> 1. Assert: _specifier_ begins with _"#"_.
> 1. If _specifier_ is exactly equal to _"#"_ or starts with _"#/"_, then
>    1. Throw an _Invalid Module Specifier_ error.
> 1. Let _packageURL_ be the result of **READ_PACKAGE_SCOPE**(_parentURL_).
> 1. If _packageURL_ is not **null**, then
>    1. Let _pjson_ be the result of **READ_PACKAGE_JSON**(_packageURL_).
>    1. If _pjson.imports_ is a non-null Object, then
>       1. Let _resolvedMatch_ be the result of
>          **PACKAGE_IMPORTS_EXPORTS_RESOLVE**(_specifier_, _pjson.imports_,
>          _packageURL_, **true**, _conditions_).
>       1. If _resolvedMatch_._resolve_ is not **null** or **undefined**, then
>          1. Return _resolvedMatch_.
> 1. Throw a _Package Import Not Defined_ error.

**PACKAGE_IMPORTS_EXPORTS_RESOLVE**(_matchKey_, _matchObj_, _packageURL_,
_isImports_, _conditions_)

> 1. If _matchKey_ is a key of _matchObj_, and does not end in _"*"_, then
>    1. Let _target_ be the value of _matchObj_\[_matchKey_\].
>    1. Let _resolved_ be the result of **PACKAGE_TARGET_RESOLVE**(
>       _packageURL_, _target_, _""_, _isImports_, _conditions_).
>    1. Return the object _{ resolved, exact: **true** }_.
> 1. Let _expansionKeys_ be the list of keys of _matchObj_ ending in _"/"_,
>    sorted by length descending.
> 1. For each key _expansionKey_ in _expansionKeys_, do
>    1. If _matchKey_ starts with _expansionKey_, then
>       1. Let _target_ be the value of _matchObj_\[_expansionKey_\].
>       1. Let _subpath_ be the substring of _matchKey_ starting at the
>          index of the length of _expansionKey_.
>       1. Let _resolved_ be the result of **PACKAGE_TARGET_RESOLVE**(
>          _packageURL_, _target_, _subpath_, _isImports_, _conditions_).
>       1. Return the object _{ resolved, exact: **false** }_.
> 1. Return the object _{ resolved: **null**, exact: **true** }_.

**PACKAGE_TARGET_RESOLVE**(_packageURL_, _target_, _subpath_, _internal_,
_conditions_)

> 1. If _target_ is a String, then
>    1. If _subpath_ has non-zero length and _target_ does not end with _"/"_,
>       throw an _Invalid Module Specifier_ error.
>    1. If _target_ does not start with _"./"_, then
>       1. If _internal_ is **true** and _target_ does not start with _"../"_ or
>          _"/"_ and is not a valid URL, then
>          1. Return **PACKAGE_RESOLVE**(_target_ + _subpath_,
>             _packageURL_ + _"/"_)_.
>       1. Otherwise, throw an _Invalid Package Target_ error.
>    1. If _target_ split on _"/"_ or _"\\"_ contains any _"."_, _".."_ or
>       _"node_modules"_ segments after the first segment, throw an
>       _Invalid Module Specifier_ error.
>    1. Let _resolvedTarget_ be the URL resolution of the concatenation of
>       _packageURL_ and _target_.
>    1. Assert: _resolvedTarget_ is contained in _packageURL_.
>    1. If _subpath_ split on _"/"_ or _"\\"_ contains any _"."_, _".."_ or
>       _"node_modules"_ segments, throw an _Invalid Module Specifier_ error.
>    1. Return the URL resolution of the concatenation of _subpath_ and
>       _resolvedTarget_.
> 1. Otherwise, if _target_ is a non-null Object, then
>    1. If _exports_ contains any index property keys, as defined in ECMA-262
>       [6.1.7 Array Index][], throw an _Invalid Package Configuration_ error.
>    1. For each property _p_ of _target_, in object insertion order as,
>       1. If _p_ equals _"default"_ or _conditions_ contains an entry for _p_,
>          then
>          1. Let _targetValue_ be the value of the _p_ property in _target_.
>          1. Let _resolved_ be the result of **PACKAGE_TARGET_RESOLVE**(
>             _packageURL_, _targetValue_, _subpath_, _internal_, _conditions_).
>          1. If _resolved_ is equal to **undefined**, continue the loop.
>          1. Return _resolved_.
>    1. Return **undefined**.
> 1. Otherwise, if _target_ is an Array, then
>    1. If _target.length is zero, return **null**.
>    1. For each item _targetValue_ in _target_, do
>       1. Let _resolved_ be the result of **PACKAGE_TARGET_RESOLVE**(
>          _packageURL_, _targetValue_, _subpath_, _internal_, _conditions_),
>          continuing the loop on any _Invalid Package Target_ error.
>       1. If _resolved_ is **undefined**, continue the loop.
>       1. Return _resolved_.
>    1. Return or throw the last fallback resolution **null** return or error.
> 1. Otherwise, if _target_ is _null_, return **null**.
> 1. Otherwise throw an _Invalid Package Target_ error.

**ESM_FORMAT**(_url_)

> 1. Assert: _url_ corresponds to an existing file.
> 1. Let _pjson_ be the result of **READ_PACKAGE_SCOPE**(_url_).
> 1. If _url_ ends in _".mjs"_, then
>    1. Return _"module"_.
> 1. If _url_ ends in _".cjs"_, then
>    1. Return _"commonjs"_.
> 1. If _pjson?.type_ exists and is _"module"_, then
>    1. If _url_ ends in _".js"_, then
>       1. Return _"module"_.
>    1. Throw an _Unsupported File Extension_ error.
> 1. Otherwise,
>    1. Throw an _Unsupported File Extension_ error.

**READ_PACKAGE_SCOPE**(_url_)

> 1. Let _scopeURL_ be _url_.
> 1. While _scopeURL_ is not the file system root,
>    1. Set _scopeURL_ to the parent URL of _scopeURL_.
>    1. If _scopeURL_ ends in a _"node_modules"_ path segment, return **null**.
>    1. Let _pjson_ be the result of **READ_PACKAGE_JSON**(_scopeURL_).
>    1. If _pjson_ is not **null**, then
>       1. Return _pjson_.
> 1. Return **null**.

**READ_PACKAGE_JSON**(_packageURL_)

> 1. Let _pjsonURL_ be the resolution of _"package.json"_ within _packageURL_.
> 1. If the file at _pjsonURL_ does not exist, then
>    1. Return **null**.
> 1. If the file at _packageURL_ does not parse as valid JSON, then
>    1. Throw an _Invalid Package Configuration_ error.
> 1. Return the parsed JSON source of the file at _pjsonURL_.

</details>

### Customizing ESM specifier resolution algorithm

The current specifier resolution does not support all default behavior of
the CommonJS loader. One of the behavior differences is automatic resolution
of file extensions and the ability to import directories that have an index
file.

The `--experimental-specifier-resolution=[mode]` flag can be used to customize
the extension resolution algorithm. The default mode is `explicit`, which
requires the full path to a module be provided to the loader. To enable the
automatic extension resolution and importing from directories that include an
index file use the `node` mode.

```console
$ node index.mjs
success!
$ node index # Failure!
Error: Cannot find module
$ node --experimental-specifier-resolution=node index
success!
```

[Babel]: https://babeljs.io/
[CommonJS]: modules.html
[Conditional exports]: #esm_conditional_exports
[Dynamic `import()`]: https://wiki.developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#Dynamic_Imports
[ECMAScript-modules implementation]: https://github.com/nodejs/modules/blob/master/doc/plan-for-new-modules-implementation.md
[ES Module Integration Proposal for Web Assembly]: https://github.com/webassembly/esm-integration
[Node.js EP for ES Modules]: https://github.com/nodejs/node-eps/blob/master/002-es-modules.md
[Terminology]: #esm_terminology
[WHATWG JSON modules specification]: https://html.spec.whatwg.org/#creating-a-json-module-script
[`data:` URLs]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
[`esm`]: https://github.com/standard-things/esm#readme
[`export`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/export
[`getFormat` hook]: #esm_code_getformat_code_hook
[`import()`]: #esm_import_expressions
[`import.meta.url`]: #esm_import_meta
[`import`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import
[`module.createRequire()`]: modules.html#modules_module_createrequire_filename
[`module.syncBuiltinESMExports()`]: modules.html#modules_module_syncbuiltinesmexports
[`transformSource` hook]: #esm_code_transformsource_code_hook
[ArrayBuffer]: https://www.ecma-international.org/ecma-262/6.0/#sec-arraybuffer-constructor
[SharedArrayBuffer]: https://tc39.es/ecma262/#sec-sharedarraybuffer-constructor
[string]: https://www.ecma-international.org/ecma-262/6.0/#sec-string-constructor
[TypedArray]: https://www.ecma-international.org/ecma-262/6.0/#sec-typedarray-objects
[Uint8Array]: https://www.ecma-international.org/ecma-262/6.0/#sec-uint8array
[`util.TextDecoder`]: util.html#util_class_util_textdecoder
[dynamic instantiate hook]: #esm_code_dynamicinstantiate_code_hook
[import an ES or CommonJS module for its side effects only]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#Import_a_module_for_its_side_effects_only
[special scheme]: https://url.spec.whatwg.org/#special-scheme
[the full specifier path]: #esm_mandatory_file_extensions
[the official standard format]: https://tc39.github.io/ecma262/#sec-modules
[the dual CommonJS/ES module packages section]: #esm_dual_commonjs_es_module_packages
[transpiler loader example]: #esm_transpiler_loader
[6.1.7 Array Index]: https://tc39.es/ecma262/#integer-index
[Top-Level Await]: https://github.com/tc39/proposal-top-level-await
