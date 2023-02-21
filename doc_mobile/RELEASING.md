# Release Instructions

1. In `src/node_version.h`, flag `NODE_VERSION_IS_RELEASE` to 1
2. In `src/node_mobile_version.h`, set the MAJOR/MINOR/PATCH version numbers
3. Update `doc_mobile/CHANGELOG.md`
4. Compile for Android: `./tools/android_build.sh $NDK_PATH x $SDK_VERSION`
5. Compile for iOS: `./tools/ios_framework_prepare.sh`
6. Test a sample project on devices and simulators/emulators
7. Create zip file `nodejs-mobile-v$X.$Y.$Z-ios.zip` containing:
    - include
      - node
        - (each header file)
    - NodeMobile.xcframework
    - Release-iphoneos
      - NodeMobile.framework
      - DELETE large .dSym file
    - Release-universal
      - NodeMobile.framework
      - DELETE large .dSym file
8. Create zip file `nodejs-mobile-v$X.$Y.$Z-android.zip` containing:
    - include
      - node
        - (each header file)
    - bin
      - (each architecture)
        - libnode.so
9. git commit as `release: nodejs-mobile $X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
10. git tag it as `v$X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
11. `git push` and `git push origin --tags`
12. Create a GitHub release based on the git tag, upload zips, write changelog
13. Opposite of first step: unflag `NODE_VERSION_IS_RELEASE`
14. git commit as `src: unflag NODE_VERSION_IS_RELEASE`
