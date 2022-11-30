/* IMPORTANT
 * This snapshot file is auto-generated, but designed for humans.
 * It should be checked into source control and tracked carefully.
 * Re-generate by setting TAP_SNAPSHOT=1 and running tests.
 * Make sure to inspect the output below.  Do not ignore changes!
 */
'use strict'
exports[`test/lib/npm.js TAP usage basic usage > must match snapshot 1`] = `
npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term>
npm help npm       more involved overview

All commands:

    access, adduser, audit, bin, bugs, cache, ci, completion,
    config, dedupe, deprecate, diff, dist-tag, docs, doctor,
    edit, exec, explain, explore, find-dupes, fund, get, help,
    hook, init, install, install-ci-test, install-test, link,
    ll, login, logout, ls, org, outdated, owner, pack, ping,
    pkg, prefix, profile, prune, publish, rebuild, repo,
    restart, root, run-script, search, set, set-script,
    shrinkwrap, star, stars, start, stop, team, test, token,
    uninstall, unpublish, unstar, update, version, view, whoami

Specify configs in the ini-formatted file:
    /some/config/file/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@{VERSION} {BASEDIR}
`

exports[`test/lib/npm.js TAP usage set process.stdout.columns columns=0 > must match snapshot 1`] = `
npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term>
npm help npm       more involved overview

All commands:

    access, adduser, audit, bin, bugs, cache, ci, completion,
    config, dedupe, deprecate, diff, dist-tag, docs, doctor,
    edit, exec, explain, explore, find-dupes, fund, get, help,
    hook, init, install, install-ci-test, install-test, link,
    ll, login, logout, ls, org, outdated, owner, pack, ping,
    pkg, prefix, profile, prune, publish, rebuild, repo,
    restart, root, run-script, search, set, set-script,
    shrinkwrap, star, stars, start, stop, team, test, token,
    uninstall, unpublish, unstar, update, version, view, whoami

Specify configs in the ini-formatted file:
    /some/config/file/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@{VERSION} {BASEDIR}
`

exports[`test/lib/npm.js TAP usage set process.stdout.columns columns=90 > must match snapshot 1`] = `
npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term>
npm help npm       more involved overview

All commands:

    access, adduser, audit, bin, bugs, cache, ci, completion,
    config, dedupe, deprecate, diff, dist-tag, docs, doctor,
    edit, exec, explain, explore, find-dupes, fund, get, help,
    hook, init, install, install-ci-test, install-test, link,
    ll, login, logout, ls, org, outdated, owner, pack, ping,
    pkg, prefix, profile, prune, publish, rebuild, repo,
    restart, root, run-script, search, set, set-script,
    shrinkwrap, star, stars, start, stop, team, test, token,
    uninstall, unpublish, unstar, update, version, view, whoami

Specify configs in the ini-formatted file:
    /some/config/file/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@{VERSION} {BASEDIR}
`

exports[`test/lib/npm.js TAP usage with browser > must match snapshot 1`] = `
npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term> (in a browser)
npm help npm       more involved overview (in a browser)

All commands:

    access, adduser, audit, bin, bugs, cache, ci, completion,
    config, dedupe, deprecate, diff, dist-tag, docs, doctor,
    edit, exec, explain, explore, find-dupes, fund, get, help,
    hook, init, install, install-ci-test, install-test, link,
    ll, login, logout, ls, org, outdated, owner, pack, ping,
    pkg, prefix, profile, prune, publish, rebuild, repo,
    restart, root, run-script, search, set, set-script,
    shrinkwrap, star, stars, start, stop, team, test, token,
    uninstall, unpublish, unstar, update, version, view, whoami

Specify configs in the ini-formatted file:
    /some/config/file/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@{VERSION} {BASEDIR}
`

exports[`test/lib/npm.js TAP usage with long > must match snapshot 1`] = `
npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project
npm test           run this project's tests
npm run <foo>      run the script named <foo>
npm <command> -h   quick help on <command>
npm -l             display usage info for all commands
npm help <term>    search for help on <term>
npm help npm       more involved overview

All commands:

    access          Set access level on published packages

                    Usage:
                    npm access public [<package>]
                    npm access restricted [<package>]
                    npm access grant <read-only|read-write> <scope:team> [<package>]
                    npm access revoke <scope:team> [<package>]
                    npm access 2fa-required [<package>]
                    npm access 2fa-not-required [<package>]
                    npm access ls-packages [<user>|<scope>|<scope:team>]
                    npm access ls-collaborators [<package> [<user>]]
                    npm access edit [<package>]

                    Options:
                    [--registry <registry>] [--otp <otp>]

                    Run "npm help access" for more info

    adduser         Add a registry user account

                    Usage:
                    npm adduser

                    Options:
                    [--registry <registry>] [--scope <@scope>]
                    [--auth-type <legacy|web|sso|saml|oauth|webauthn>]

                    aliases: login, add-user

                    Run "npm help adduser" for more info

    audit           Run a security audit

                    Usage:
                    npm audit [fix|signatures]

                    Options:
                    [--audit-level <info|low|moderate|high|critical|none>] [--dry-run] [-f|--force]
                    [--json] [--package-lock-only]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
                    [--foreground-scripts] [--ignore-scripts]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    Run "npm help audit" for more info

    bin             Display npm bin folder

                    Usage:
                    npm bin

                    Options:
                    [-g|--global]

                    Run "npm help bin" for more info

    bugs            Report bugs for a package in a web browser

                    Usage:
                    npm bugs [<pkgname> [<pkgname> ...]]

                    Options:
                    [--no-browser|--browser <browser>] [--registry <registry>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    alias: issues

                    Run "npm help bugs" for more info

    cache           Manipulates packages cache

                    Usage:
                    npm cache add <package-spec>
                    npm cache clean [<key>]
                    npm cache ls [<name>@<version>]
                    npm cache verify

                    Options:
                    [--cache <cache>]

                    Run "npm help cache" for more info

    ci              Clean install a project

                    Usage:
                    npm ci

                    Options:
                    [--no-audit] [--foreground-scripts] [--ignore-scripts]
                    [--script-shell <script-shell>]

                    aliases: clean-install, ic, install-clean, isntall-clean

                    Run "npm help ci" for more info

    completion      Tab Completion for npm

                    Usage:
                    npm completion

                    Run "npm help completion" for more info

    config          Manage the npm configuration files

                    Usage:
                    npm config set <key>=<value> [<key>=<value> ...]
                    npm config get [<key> [<key> ...]]
                    npm config delete <key> [<key> ...]
                    npm config list [--json]
                    npm config edit

                    Options:
                    [--json] [-g|--global] [--editor <editor>] [-L|--location <global|user|project>]
                    [-l|--long]

                    alias: c

                    Run "npm help config" for more info

    dedupe          Reduce duplication in the package tree

                    Usage:
                    npm dedupe

                    Options:
                    [--global-style] [--legacy-bundling] [--strict-peer-deps] [--no-package-lock]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--ignore-scripts]
                    [--no-audit] [--no-bin-links] [--no-fund] [--dry-run]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: ddp

                    Run "npm help dedupe" for more info

    deprecate       Deprecate a version of a package

                    Usage:
                    npm deprecate <package-spec> <message>

                    Options:
                    [--registry <registry>] [--otp <otp>]

                    Run "npm help deprecate" for more info

    diff            The registry diff command

                    Usage:
                    npm diff [...<paths>]

                    Options:
                    [--diff <package-spec> [--diff <package-spec> ...]] [--diff-name-only]
                    [--diff-unified <number>] [--diff-ignore-all-space] [--diff-no-prefix]
                    [--diff-src-prefix <path>] [--diff-dst-prefix <path>] [--diff-text] [-g|--global]
                    [--tag <tag>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    Run "npm help diff" for more info

    dist-tag        Modify package distribution tags

                    Usage:
                    npm dist-tag add <package-spec (with version)> [<tag>]
                    npm dist-tag rm <package-spec> <tag>
                    npm dist-tag ls [<package-spec>]

                    Options:
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    alias: dist-tags

                    Run "npm help dist-tag" for more info

    docs            Open documentation for a package in a web browser

                    Usage:
                    npm docs [<pkgname> [<pkgname> ...]]

                    Options:
                    [--no-browser|--browser <browser>] [--registry <registry>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    alias: home

                    Run "npm help docs" for more info

    doctor          Check your npm environment

                    Usage:
                    npm doctor

                    Options:
                    [--registry <registry>]

                    Run "npm help doctor" for more info

    edit            Edit an installed package

                    Usage:
                    npm edit <pkg>[/<subpkg>...]

                    Options:
                    [--editor <editor>]

                    Run "npm help edit" for more info

    exec            Run a command from a local or remote npm package

                    Usage:
                    npm exec -- <pkg>[@<version>] [args...]
                    npm exec --package=<pkg>[@<version>] -- <cmd> [args...]
                    npm exec -c '<cmd> [args...]'
                    npm exec --package=foo -c '<cmd> [args...]'

                    Options:
                    [--package <package-spec> [--package <package-spec> ...]] [-c|--call <call>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    alias: x

                    Run "npm help exec" for more info

    explain         Explain installed packages

                    Usage:
                    npm explain <package-spec>

                    Options:
                    [--json] [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]

                    alias: why

                    Run "npm help explain" for more info

    explore         Browse an installed package

                    Usage:
                    npm explore <pkg> [ -- <command>]

                    Options:
                    [--shell <shell>]

                    Run "npm help explore" for more info

    find-dupes      Find duplication in the package tree

                    Usage:
                    npm find-dupes

                    Options:
                    [--global-style] [--legacy-bundling] [--strict-peer-deps] [--no-package-lock]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--ignore-scripts]
                    [--no-audit] [--no-bin-links] [--no-fund]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    Run "npm help find-dupes" for more info

    fund            Retrieve funding information

                    Usage:
                    npm fund [<package-spec>]

                    Options:
                    [--json] [--no-browser|--browser <browser>] [--unicode]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [--which <fundingSourceNumber>]

                    Run "npm help fund" for more info

    get             Get a value from the npm configuration

                    Usage:
                    npm get [<key> ...] (See \`npm config\`)

                    Run "npm help get" for more info

    help            Get help on npm

                    Usage:
                    npm help <term> [<terms..>]

                    Options:
                    [--viewer <viewer>]

                    alias: hlep

                    Run "npm help help" for more info

    hook            Manage registry hooks

                    Usage:
                    npm hook add <pkg> <url> <secret> [--type=<type>]
                    npm hook ls [pkg]
                    npm hook rm <id>
                    npm hook update <id> <url> <secret>

                    Options:
                    [--registry <registry>] [--otp <otp>]

                    Run "npm help hook" for more info

    init            Create a package.json file

                    Usage:
                    npm init <package-spec> (same as \`npx <package-spec>)
                    npm init <@scope> (same as \`npx <@scope>/create\`)

                    Options:
                    [-y|--yes] [-f|--force] [--scope <@scope>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--no-workspaces-update] [--include-workspace-root]

                    aliases: create, innit

                    Run "npm help init" for more info

    install         Install a package

                    Usage:
                    npm install [<package-spec> ...]

                    Options:
                    [-S|--save|--no-save|--save-prod|--save-dev|--save-optional|--save-peer|--save-bundle]
                    [-E|--save-exact] [-g|--global] [--global-style] [--legacy-bundling]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
                    [--strict-peer-deps] [--no-package-lock] [--foreground-scripts]
                    [--ignore-scripts] [--no-audit] [--no-bin-links] [--no-fund] [--dry-run]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    aliases: add, i, in, ins, inst, insta, instal, isnt, isnta, isntal, isntall

                    Run "npm help install" for more info

    install-ci-test Install a project with a clean slate and run tests

                    Usage:
                    npm install-ci-test

                    Options:
                    [--no-audit] [--foreground-scripts] [--ignore-scripts]
                    [--script-shell <script-shell>]

                    alias: cit

                    Run "npm help install-ci-test" for more info

    install-test    Install package(s) and run tests

                    Usage:
                    npm install-test [<package-spec> ...]

                    Options:
                    [-S|--save|--no-save|--save-prod|--save-dev|--save-optional|--save-peer|--save-bundle]
                    [-E|--save-exact] [-g|--global] [--global-style] [--legacy-bundling]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
                    [--strict-peer-deps] [--no-package-lock] [--foreground-scripts]
                    [--ignore-scripts] [--no-audit] [--no-bin-links] [--no-fund] [--dry-run]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: it

                    Run "npm help install-test" for more info

    link            Symlink a package folder

                    Usage:
                    npm link [<package-spec>]

                    Options:
                    [-S|--save|--no-save|--save-prod|--save-dev|--save-optional|--save-peer|--save-bundle]
                    [-E|--save-exact] [-g|--global] [--global-style] [--legacy-bundling]
                    [--strict-peer-deps] [--no-package-lock]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--ignore-scripts]
                    [--no-audit] [--no-bin-links] [--no-fund] [--dry-run]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: ln

                    Run "npm help link" for more info

    ll              List installed packages

                    Usage:
                    npm ll [[<@scope>/]<pkg> ...]

                    Options:
                    [-a|--all] [--json] [-l|--long] [-p|--parseable] [-g|--global] [--depth <depth>]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--link]
                    [--package-lock-only] [--unicode]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: la

                    Run "npm help ll" for more info

    login           Add a registry user account

                    Usage:
                    npm adduser

                    Options:
                    [--registry <registry>] [--scope <@scope>]
                    [--auth-type <legacy|web|sso|saml|oauth|webauthn>]

                    aliases: login, add-user

                    Run "npm help adduser" for more info

    logout          Log out of the registry

                    Usage:
                    npm logout

                    Options:
                    [--registry <registry>] [--scope <@scope>]

                    Run "npm help logout" for more info

    ls              List installed packages

                    Usage:
                    npm ls <package-spec>

                    Options:
                    [-a|--all] [--json] [-l|--long] [-p|--parseable] [-g|--global] [--depth <depth>]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--link]
                    [--package-lock-only] [--unicode]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: list

                    Run "npm help ls" for more info

    org             Manage orgs

                    Usage:
                    npm org set orgname username [developer | admin | owner]
                    npm org rm orgname username
                    npm org ls orgname [<username>]

                    Options:
                    [--registry <registry>] [--otp <otp>] [--json] [-p|--parseable]

                    alias: ogr

                    Run "npm help org" for more info

    outdated        Check for outdated packages

                    Usage:
                    npm outdated [<package-spec> ...]

                    Options:
                    [-a|--all] [--json] [-l|--long] [-p|--parseable] [-g|--global]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]

                    Run "npm help outdated" for more info

    owner           Manage package owners

                    Usage:
                    npm owner add <user> <package-spec>
                    npm owner rm <user> <package-spec>
                    npm owner ls <package-spec>

                    Options:
                    [--registry <registry>] [--otp <otp>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces]

                    alias: author

                    Run "npm help owner" for more info

    pack            Create a tarball from a package

                    Usage:
                    npm pack <package-spec>

                    Options:
                    [--dry-run] [--json] [--pack-destination <pack-destination>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    Run "npm help pack" for more info

    ping            Ping npm registry

                    Usage:
                    npm ping

                    Options:
                    [--registry <registry>]

                    Run "npm help ping" for more info

    pkg             Manages your package.json

                    Usage:
                    npm pkg set <key>=<value> [<key>=<value> ...]
                    npm pkg get [<key> [<key> ...]]
                    npm pkg delete <key> [<key> ...]
                    npm pkg set [<array>[<index>].<key>=<value> ...]
                    npm pkg set [<array>[].<key>=<value> ...]

                    Options:
                    [-f|--force] [--json]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces]

                    Run "npm help pkg" for more info

    prefix          Display prefix

                    Usage:
                    npm prefix [-g]

                    Options:
                    [-g|--global]

                    Run "npm help prefix" for more info

    profile         Change settings on your registry profile

                    Usage:
                    npm profile enable-2fa [auth-only|auth-and-writes]
                    npm profile disable-2fa
                    npm profile get [<key>]
                    npm profile set <key> <value>

                    Options:
                    [--registry <registry>] [--json] [-p|--parseable] [--otp <otp>]

                    Run "npm help profile" for more info

    prune           Remove extraneous packages

                    Usage:
                    npm prune [[<@scope>/]<pkg>...]

                    Options:
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]] [--dry-run]
                    [--json] [--foreground-scripts] [--ignore-scripts]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    Run "npm help prune" for more info

    publish         Publish a package

                    Usage:
                    npm publish <package-spec>

                    Options:
                    [--tag <tag>] [--access <restricted|public>] [--dry-run] [--otp <otp>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    Run "npm help publish" for more info

    rebuild         Rebuild a package

                    Usage:
                    npm rebuild [<package-spec>] ...]

                    Options:
                    [-g|--global] [--no-bin-links] [--foreground-scripts] [--ignore-scripts]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    alias: rb

                    Run "npm help rebuild" for more info

    repo            Open package repository page in the browser

                    Usage:
                    npm repo [<pkgname> [<pkgname> ...]]

                    Options:
                    [--no-browser|--browser <browser>] [--registry <registry>]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    Run "npm help repo" for more info

    restart         Restart a package

                    Usage:
                    npm restart [-- <args>]

                    Options:
                    [--ignore-scripts] [--script-shell <script-shell>]

                    Run "npm help restart" for more info

    root            Display npm root

                    Usage:
                    npm root

                    Options:
                    [-g|--global]

                    Run "npm help root" for more info

    run-script      Run arbitrary package scripts

                    Usage:
                    npm run-script <command> [-- <args>]

                    Options:
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--if-present] [--ignore-scripts]
                    [--foreground-scripts] [--script-shell <script-shell>]

                    aliases: run, rum, urn

                    Run "npm help run-script" for more info

    search          Search for packages

                    Usage:
                    npm search [search terms ...]

                    Options:
                    [-l|--long] [--json] [--color|--no-color|--color always] [-p|--parseable]
                    [--no-description] [--searchopts <searchopts>] [--searchexclude <searchexclude>]
                    [--registry <registry>] [--prefer-online] [--prefer-offline] [--offline]

                    aliases: find, s, se

                    Run "npm help search" for more info

    set             Set a value in the npm configuration

                    Usage:
                    npm set <key>=<value> [<key>=<value> ...] (See \`npm config\`)

                    Run "npm help set" for more info

    set-script      Set tasks in the scripts section of package.json, deprecated

                    Usage:
                    npm set-script [<script>] [<command>]

                    Options:
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    Run "npm help set-script" for more info

    shrinkwrap      Lock down dependency versions for publication

                    Usage:
                    npm shrinkwrap

                    Run "npm help shrinkwrap" for more info

    star            Mark your favorite packages

                    Usage:
                    npm star [<package-spec>...]

                    Options:
                    [--registry <registry>] [--unicode] [--otp <otp>]

                    Run "npm help star" for more info

    stars           View packages marked as favorites

                    Usage:
                    npm stars [<user>]

                    Options:
                    [--registry <registry>]

                    Run "npm help stars" for more info

    start           Start a package

                    Usage:
                    npm start [-- <args>]

                    Options:
                    [--ignore-scripts] [--script-shell <script-shell>]

                    Run "npm help start" for more info

    stop            Stop a package

                    Usage:
                    npm stop [-- <args>]

                    Options:
                    [--ignore-scripts] [--script-shell <script-shell>]

                    Run "npm help stop" for more info

    team            Manage organization teams and team memberships

                    Usage:
                    npm team create <scope:team> [--otp <otpcode>]
                    npm team destroy <scope:team> [--otp <otpcode>]
                    npm team add <scope:team> <user> [--otp <otpcode>]
                    npm team rm <scope:team> <user> [--otp <otpcode>]
                    npm team ls <scope>|<scope:team>

                    Options:
                    [--registry <registry>] [--otp <otp>] [-p|--parseable] [--json]

                    Run "npm help team" for more info

    test            Test a package

                    Usage:
                    npm test [-- <args>]

                    Options:
                    [--ignore-scripts] [--script-shell <script-shell>]

                    aliases: tst, t

                    Run "npm help test" for more info

    token           Manage your authentication tokens

                    Usage:
                    npm token list
                    npm token revoke <id|token>
                    npm token create [--read-only] [--cidr=list]

                    Options:
                    [--read-only] [--cidr <cidr> [--cidr <cidr> ...]] [--registry <registry>]
                    [--otp <otp>]

                    Run "npm help token" for more info

    uninstall       Remove a package

                    Usage:
                    npm uninstall [<@scope>/]<pkg>...

                    Options:
                    [-S|--save|--no-save|--save-prod|--save-dev|--save-optional|--save-peer|--save-bundle]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    aliases: unlink, remove, rm, r, un

                    Run "npm help uninstall" for more info

    unpublish       Remove a package from the registry

                    Usage:
                    npm unpublish [<package-spec>]

                    Options:
                    [--dry-run] [-f|--force]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces]

                    Run "npm help unpublish" for more info

    unstar          Remove an item from your favorite packages

                    Usage:
                    npm unstar [<package-spec>...]

                    Options:
                    [--registry <registry>] [--unicode] [--otp <otp>]

                    Run "npm help unstar" for more info

    update          Update packages

                    Usage:
                    npm update [<pkg>...]

                    Options:
                    [-S|--save|--no-save|--save-prod|--save-dev|--save-optional|--save-peer|--save-bundle]
                    [-g|--global] [--global-style] [--legacy-bundling]
                    [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
                    [--strict-peer-deps] [--no-package-lock] [--foreground-scripts]
                    [--ignore-scripts] [--no-audit] [--no-bin-links] [--no-fund] [--dry-run]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root] [--install-links]

                    aliases: up, upgrade, udpate

                    Run "npm help update" for more info

    version         Bump a package version

                    Usage:
                    npm version [<newversion> | major | minor | patch | premajor | preminor | prepatch | prerelease | from-git]

                    Options:
                    [--allow-same-version] [--no-commit-hooks] [--no-git-tag-version] [--json]
                    [--preid prerelease-id] [--sign-git-tag]
                    [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--no-workspaces-update] [--include-workspace-root]

                    alias: verison

                    Run "npm help version" for more info

    view            View registry info

                    Usage:
                    npm view [<package-spec>] [<field>[.subfield]...]

                    Options:
                    [--json] [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
                    [-ws|--workspaces] [--include-workspace-root]

                    aliases: info, show, v

                    Run "npm help view" for more info

    whoami          Display npm username

                    Usage:
                    npm whoami

                    Options:
                    [--registry <registry>]

                    Run "npm help whoami" for more info

Specify configs in the ini-formatted file:
    /some/config/file/.npmrc
or on the command line via: npm <command> --key=value

More configuration info: npm help config
Configuration fields: npm help 7 config

npm@{VERSION} {BASEDIR}
`
