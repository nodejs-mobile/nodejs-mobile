name: Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  SCCACHE_GHA_ENABLED: 'true'
  ANDROID_NDK_VERSION: r24
  ANDROID_TARGET_SDK_VERSION: 24

permissions:
  contents: read

jobs:
  build-android:
    strategy:
      fail-fast: false
      matrix:
        config:
          - { os: ubuntu-20.04, target_arch: arm }
          - { os: ubuntu-20.04, target_arch: arm64 }
          - { os: ubuntu-20.04, target_arch: x86_64 }

    runs-on: ${{ matrix.config.os }}
    env:
      TARGET_ARCH: ${{ matrix.config.target_arch }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: '0'

      - name: Run sccache-cache
        uses: mozilla-actions/sccache-action@v0.0.6

      - name: Install build utils
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-multilib g++-multilib

      - name: Setup Android NDK
        uses: nttld/setup-ndk@v1
        id: setup-ndk
        with:
          ndk-version: ${{ env.ANDROID_NDK_VERSION }}
          add-to-path: false

      - name: Build
        env:
          MY_ANDROID_NDK_HOME: ${{ steps.setup-ndk.outputs.ndk-path }}
        run: |
          ./tools/android_build.sh $MY_ANDROID_NDK_HOME $ANDROID_TARGET_SDK_VERSION $TARGET_ARCH
          rm -rf ./out_android/libnode

      - uses: actions/upload-artifact@v4
        with:
          name: node-android-${{ env.TARGET_ARCH }}
          path: out_android

  build-ios:
    strategy:
      fail-fast: false
      matrix:
        config:
          - { os: macos-13, target_arch: arm64, xcode: 15.2 }
          - { os: macos-14, target_arch: arm64-simulator, xcode: 15.4 }
          - { os: macos-13, target_arch: x64-simulator, xcode: 15.2 }

    runs-on: ${{ matrix.config.os }}
    env:
      TARGET_ARCH: ${{ matrix.config.target_arch }}
      XCODE_VERSION: ${{ matrix.config.xcode }}

    steps:
      - name: Free Disk Space
        run: |
          sudo rm -rf /Library/Frameworks/Mono.framework
          sudo rm -rf /Library/Frameworks/Xamarin.iOS.framework
          sudo rm -rf /Library/Frameworks/Xamarin.Android.framework
          sudo rm -rf /Users/runner/Library/Android
          sudo rm -rf /usr/local/share/powershell
          sudo find /Applications -type d -name "Xcode_*.app" ! -name "Xcode_$XCODE_VERSION.app" -prune -exec rm -rf "{}" \;

      - uses: actions/checkout@v4
        with:
          fetch-depth: '0'

      - name: Run sccache-cache
        uses: mozilla-actions/sccache-action@v0.0.6

      - name: Xcode Select Version
        uses: mobiledevops/xcode-select-version-action@v1
        with:
          xcode-select-version: ${{ matrix.config.xcode }}

      # Python 3.12 (chosen by configure.py) doesn't have support for distutils
      # https://github.com/nodejs/node-gyp/issues/2869 workaround
      - name: Build
        run: |
          python3.12 -m venv .
          source bin/activate
          python3.12 -m pip install setuptools
          ./tools/ios_framework_prepare.sh $TARGET_ARCH

      - uses: actions/upload-artifact@v4
        with:
          name: node-ios-${{ env.TARGET_ARCH }}
          path: out_ios_${{ env.TARGET_ARCH }}

  combine-android:
    strategy:
      fail-fast: false
      matrix:
        config:
          - { os: ubuntu-20.04 }
    runs-on: ${{ matrix.config.os }}
    needs: build-android
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: '0'

      - name: Install build utils
        run: |
          sudo apt-get update
          sudo apt-get install -y gcc-multilib g++-multilib

      - name: Setup Android NDK
        uses: nttld/setup-ndk@v1
        with:
          ndk-version: ${{ env.ANDROID_NDK_VERSION }}

      - uses: actions/download-artifact@v4
        with:
          pattern: node-android-*
          merge-multiple: true
          path: out_android

      - run: rm -rf out_android/libnode

      - name: Generate config.gypi
        run: ./configure

      - name: Combine
        run: |
          mkdir -p artifacts/bin
          mkdir -p artifacts/include
          cp -R out_android/* artifacts/bin
          ./tools/copy_libnode_headers.sh android
          cp -R out_android/libnode/include/* artifacts/include

      - uses: actions/upload-artifact@v4
        with:
          name: nodejs-mobile-android
          path: artifacts

      - uses: geekyeggo/delete-artifact@v5
        with:
          name: node-android-*

  combine-ios:
    strategy:
      matrix:
        config:
          - { os: macos-14, xcode: 15.4 }
    runs-on: ${{ matrix.config.os }}
    needs: build-ios
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: '0'

      - name: Xcode Select Version
        uses: mobiledevops/xcode-select-version-action@v1
        with:
          xcode-select-version: ${{ matrix.config.xcode }}

      - uses: actions/download-artifact@v4
        with:
          pattern: node-ios-*
          merge-multiple: true
          path: out_ios

      # Python 3.12 (chosen by configure.py) doesn't have support for distutils
      # https://github.com/nodejs/node-gyp/issues/2869 workaround
      - name: Generate config.gypi
        run: |
          python3.12 -m venv .
          source bin/activate
          python3.12 -m pip install setuptools
          ./configure

      - name: Combine
        run: |
          python3.12 -m venv .
          source bin/activate
          python3.12 -m pip install setuptools
          ./tools/ios_framework_prepare.sh combine_frameworks
          mkdir -p artifacts/include
          cp -R out_ios/NodeMobile.xcframework artifacts/
          ./tools/copy_libnode_headers.sh ios
          cp -R out_ios/libnode/include/* artifacts/include

      - uses: actions/upload-artifact@v4
        with:
          name: nodejs-mobile-ios
          path: artifacts

      - uses: geekyeggo/delete-artifact@v5
        with:
          name: node-ios-*