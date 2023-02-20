# Release Instructions

1. In `src/node_version.h`, flag `NODE_VERSION_IS_RELEASE` to 1
2. In `src/node_mobile_version.h`, set the MAJOR/MINOR/PATCH version numbers
3. Update `doc_mobile/CHANGELOG.md`
4. Compile for Android: `./tools/android_build.sh $NDK_PATH x $SDK_VERSION`
5. Compile for iOS: `./tools/ios_framework_prepare.sh`
6. Create zip files from the outputs of the two steps above
7. git commit as `release: nodejs-mobile $X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
8. git tag it as `v$X.$Y.$Z`, replacing `$X`, `$Y`, `$Z`
9. `git push` and `git push origin --tags`
10. Create a GitHub release based on the git tag, upload zips, write changelog
11. Opposite of first step: unflag `NODE_VERSION_IS_RELEASE`
12. git commit as `src: unflag NODE_VERSION_IS_RELEASE`
