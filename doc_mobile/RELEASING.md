# Release Instructions

1. In `src/node_version.h`, flag `NODE_VERSION_IS_RELEASE` to 1
2. In `src/node_mobile_version.h`, set the MAJOR/MINOR/PATCH version numbers
3. Update `doc_mobile/CHANGELOG.md`
4. Compile for Android: `./tools/android_build.sh $NDK_PATH x $SDK_VERSION`
5. Compile for iOS: `./tools/ios_framework_prepare.sh`
6. Create zip file `nodejs-mobile-v$X.$Y.$Z-ios.zip` containing:
    - include
      - node
        - (each header file)
    - Release-iphoneos
      - NodeMobile.framework
7. Create zip file `nodejs-mobile-v$X.$Y.$Z-android.zip` containing:
    - include
      - node
        - (each header file)
    - bin
      - (each architecture)
        - libnode.so
8. git commit as `release: nodejs-mobile $X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
9. git tag it as `v$X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
10. `git push` and `git push origin --tags`
11. Create a GitHub release based on the git tag, upload zips, write changelog
12. Opposite of first step: unflag `NODE_VERSION_IS_RELEASE`
13. git commit as `src: unflag NODE_VERSION_IS_RELEASE`
