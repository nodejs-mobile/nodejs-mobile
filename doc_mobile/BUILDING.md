# Build Instructions

## Prerequisites to build the Android library on Linux Ubuntu/Debian:

### Basic build tools:
```sh
sudo apt-get install -y build-essential git python
```

### Install curl and unzip (needed to download the Android NDK):
```sh
sudo apt-get install -y curl unzip
```

### Install Android NDK r21b for Linux:
Choose a location where you want to install the Android NDK and run:
```sh
curl https://dl.google.com/android/repository/android-ndk-r21b-linux-x86_64.zip -o ndk.zip
unzip ndk.zip
```
It will create a `android-ndk-r21b` folder. Save that path for later.

## Prerequisites to build the Android library on macOS:

### Git:

Run `git` in a terminal window, it will show a prompt to install it if not already present.
As an alternative, installing one of these will install `git`:
* Xcode, with the Command Line Tools.
* [Homebrew](https://brew.sh/)
* [Git-SCM](https://git-scm.com/download/mac)

### Install Android NDK r21b for macOS:
Choose a location where you want to install the Android NDK and run:
```sh
curl https://dl.google.com/android/repository/android-ndk-r21b-darwin-x86_64.zip -o ndk.zip
unzip ndk.zip
```
It will create a `android-ndk-r21b` folder. Save that path for later.

## Building the Android library on Linux or macOS:

### 1) Clone this repo and check out the `mobile-master` branch:

```sh
git clone https://github.com/janeasystems/nodejs-mobile
cd nodejs-mobile
git checkout mobile-master
```

### 2a) Using the Android helper script:

The `tools/android_build.sh` script takes as first argument the Android NDK path (in our case is `~/android-ndk-r21b`). The second argument must be the Android SDK version as a two-digit number. The third argument is the target architecture, which can be one of the following: `arm`, `x86`, `arm64` or `x86_64`. You can omit the third argument, and it will build all available architectures.

Run (example arguments):

```sh
./tools/android_build.sh ~/android-ndk-r21b 23
```

When done, each built shared library will be placed in `out_android/$(ARCHITECTURE)/libnode.so`.

### 2b) Configure and build manually:
Run the `android-configure` script to configure the build with the path to the downloaded NDK and the desired target architecture.

```sh
source ./android-configure ../android-ndk-r21b arm
```

Start the build phase:
```sh
make
```

This will create the Android `armeabi-v7a` shared library in `out/Release/lib.target/libnode.so`.

## Prerequisites to build the iOS .framework library on macOS:

### Xcode 11 with Command Line Tools

Install Xcode 11 or higher, from the App Store, and then install the Command Line Tools by running the following command:

```sh
xcode-select --install
```

That installs `git`, as well.

### CMake

To install `CMake`, you can use a package installer like [Homebrew](https://brew.sh/).

First, install `HomeBrew`, if you don't have it already.

```sh
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

Then, use it to install `CMake`:

```sh
brew install cmake
```

## Building the iOS library using CocoaPods:

Add this to your `Podfile`:

```ruby
pod 'NodeMobile', :git => 'https://github.com/janeasystems/nodejs-mobile.git'
```

## Building the iOS .framework library on macOS:

### 1) Clone this repo and check out the `main` branch:

```sh
git clone https://github.com/nodejs-mobile/nodejs-mobile
cd nodejs-mobile
git checkout main
```

### 2) Run the helper script:

```sh
./tools/ios_framework_prepare.sh
```

That will configure `gyp` to build Node.js and its dependencies as static libraries for iOS on the arm64 and x64 architectures, using the `v8` engine configured to start with JIT disabled. The script copies those libraries to `tools/ios-framework/bin/arm64` and `tools/ios-framework/bin/x64`, respectively. It also merges them into static libraries that contain strips for both architectures, which will be placed in `tools/ios-framework/bin` and used by the `tools/ios-framework/NodeMobile.xcodeproj` Xcode project.

The helper script builds the `tools/ios-framework/NodeMobile.xcodeproj` Xcode project into three frameworks:
  - The framework to run on iOS devices: `out_ios/Release-iphoneos/NodeMobile.framework`
  - The framework to run on the iOS simulator: `out_ios/Release-iphonesimulator/NodeMobile.framework`
  - The universal framework, that runs on iOS devices and simulators: `out_ios/Release-universal/NodeMobile.framework`
