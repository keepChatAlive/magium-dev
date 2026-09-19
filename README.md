forked from
https://github.com/thuiop/magium-dev
https://github.com/thuiop/magium-dev
https://github.com/thuiop/magium-dev

this is an UNOFFICIAL magium app. original material Copyright (c) 2024 Christian Mihailescu
this is an UNOFFICIAL magium app. original material Copyright (c) 2024 Christian Mihailescu
this is an UNOFFICIAL magium app. original material Copyright (c) 2024 Christian Mihailescu

features:
Modern-ish feeling UI. minimalist icons on UI. Fixed some bugs compared to previous unreleased iteration

Dialogue speaker coloring. eg. Barry spoken lines are blue, etc.

Simplified Chinese language alongside English and French. because I am Chinese and I need it. This translation is AI generated and cannot be guaranteed for high accuracy

Enhanced formatting. Looks like some published fantasy book

Also has say, handwritten font for written on paper text, monospace font for tech related text, etc. This is less tested and only a few places have this applied.

Word appearing one by one animation effect.

Dynamic colored launcher icon based on following Flower's apparatus fan design. Dynamic Material You in-app coloring. app launcher icon based on https://www.reddit.com/r/Magium/comments/d1mijn/flowerillunaarraka_concept_art/ Source Text (C)  Cristian Mihailescu's CC BY 4.0 release. I assume no credit from this project


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
