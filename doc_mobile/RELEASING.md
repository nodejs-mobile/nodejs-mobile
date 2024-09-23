# Release Instructions

1. Start a new Git branch for this release
2. In `src/node_version.h`, flag `NODE_VERSION_IS_RELEASE` to 1
3. In `src/node_mobile_version.h`, set the MAJOR/MINOR/PATCH version numbers
4. Update `doc_mobile/CHANGELOG.md`
5. git commit as `release: nodejs-mobile $X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
6. Push this branch to GitHub and create a PR for it
7. Allow CI some time to compile all binaries successfully
8. Download binaries, and smoke test a sample project on devices and simulators/emulators
9. Merge the PR as a single commit (squash)
10. git tag as `v$X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
11. `git push origin --tags`
12. Rename downloaded zip file `nodejs-mobile-v$X.$Y.$Z-ios.zip` containing:
    - include
      - node
        - (each header file)
    - NodeMobile.xcframework
      - ios-arm64
        - NodeMobile.framework
      - ios-arm64_x86_64-simulator
        - NodeMobile.framework
13. Rename downloaded zip file `nodejs-mobile-v$X.$Y.$Z-android.zip` containing:
    - bin
      - (each architecture)
        - libnode.so
    - include
      - node
        - (each header file)
14. Create a GitHub release based on the git tag, upload zips, write changelog
15. Opposite of first step: unflag `NODE_VERSION_IS_RELEASE`
16. git commit as `src: unflag NODE_VERSION_IS_RELEASE`
