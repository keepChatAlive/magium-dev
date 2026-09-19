# Magium Offline Android

This repository contains the source required to reproduce the offline Android build. Generated web assets, dependency directories, Gradle caches, build outputs, and signing keys are intentionally excluded.

## Requirements

- Node.js 18 or newer
- JDK 17
- Android SDK Platform 36

## Build

Install the template compiler dependency:

```powershell
npm ci --prefix tools/offline-build
```

Set `JAVA_HOME` and `ANDROID_HOME`, then run:

```powershell
npm run build:android
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Android's debug signing key is generated locally during the build and is not part of the repository. Use an externally managed signing key when stable update signatures are required.

## License

See [LICENSE](LICENSE).
