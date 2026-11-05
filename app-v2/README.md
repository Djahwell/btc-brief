# BTC Brief V2 — Android app (D-12)

Separate app (`com.maisontoe.btcbriefv2`, "BTC Brief V2") installed beside V1. It is a thin
Capacitor wrapper: the WebView loads `https://djahwell.github.io/btc-brief/v2/` (the V2 page,
deployed from `public/v2/`), so page and engine updates arrive without a new APK. No data logic
lives in the app (D-4). `www/offline.html` is shown when there is no connection.

Built by `.github/workflows/v2-apk.yml` (Ubuntu 24.04, Java 21, Android SDK). The Android project
is generated in CI (`cap add android`), so nothing Android-specific is committed here. The APK is
signed with a fixed key held in repository secrets (`V2_APK_KEYSTORE_B64`, `V2_APK_KEY_PASS`), so
each new build installs over the previous one. Download: the latest `v2-apk-*` release.
