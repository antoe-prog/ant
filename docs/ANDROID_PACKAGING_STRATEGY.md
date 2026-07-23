# Android 앱 패키징 전략

작성일: 2026-06-15
상태: P1 Android 패키징 준비 완료, 내부 설치용 APK는 Capacitor WebView, Play/운영 릴리즈는 TWA + Digital Asset Links 검증 후 진행

## 결론

P1 Android 배포 전략은 목적별로 분리한다.

내부 설치/현장 검증 APK는 **Capacitor Android WebView**를 사용한다. 이 경로는 `final-judo.vercel.app`을 앱 내부 WebView로 띄우므로 Android 상단에 Chrome 주소창, 공유 버튼, 더보기 버튼이 노출되지 않는다.

Play Store 또는 운영 릴리즈용 AAB/APK는 **Trusted Web Activity(TWA) + Bubblewrap**을 유지하되, release signing SHA-256이 들어간 Digital Asset Links가 운영 도메인에서 검증된 뒤에만 fullscreen 앱 품질로 인정한다. TWA 검증이 안 된 설치본은 Android가 Custom Tab으로 내려가 상단 URL 바가 보일 수 있으므로, 현장 배포용으로 사용하지 않는다.

## 비교

| 방식 | 장점 | 리스크 | P1 판단 |
| --- | --- | --- | --- |
| TWA + Bubblewrap | 기존 PWA/Next 서버 API 유지, 앱처럼 전체 화면 실행, Play 배포용 APK/AAB 생성 가능 | HTTPS 운영 도메인, Digital Asset Links, 릴리즈 서명키 필요. 검증 전 설치본은 Custom Tab 주소창이 보일 수 있음 | Play/운영 릴리즈 후보 |
| Capacitor WebView | 네이티브 WebView로 상단 브라우저 주소창 없이 실행, 내부 설치 APK 품질 안정, 앱 프로젝트 직접 제어 | 원격 Next 웹앱 URL을 `server.url`로 연결하므로 운영 웹앱 배포 상태에 의존 | 내부 설치/현장 검증 APK 선택 |
| 순수 PWA 설치 | 가장 빠르고 앱스토어 심사 없음 | Play Store 배포 산출물 없음, 기기별 설치 UX 차이 | P0 유지 |

## 현재 준비된 산출물

- `mobile/android/twa-config.template.json`: TWA/Bubblewrap 패키징 기준 템플릿
- `mobile/android/twa`: Digital Asset Links가 아직 맞지 않는 설치본도 Chrome 주소창 대신 앱 내부 WebView fallback으로 열리도록 `fallbackType=webview`를 유지
- `mobile/android/assetlinks.template.json`: 운영 도메인에 배포할 Digital Asset Links 템플릿
- `scripts/check-android-packaging.mjs`: PWA/TWA 패키징 정적 검증
- `scripts/check-android-twa-doctor.mjs`: 운영 origin, 릴리즈 지문, JDK/Android SDK/adb/npx/ANDROID_HOME 준비 상태 JSON/Markdown 점검과 macOS/환경변수/CI 설치 힌트. 환경변수가 비어도 repo-local `.data/toolchains/jdk`, `.data/toolchains/android-sdk` fallback을 함께 확인한다
- `scripts/build-android-twa.mjs`: 운영 도메인과 릴리즈 인증서 지문을 받아 Android 패키징 입력 파일을 생성하고, Java/keytool/sdkmanager/adb/npx/ANDROID_HOME 준비 상태를 `buildReady/buildBlockers`로 출력하며, 선택적으로 Bubblewrap 빌드를 실행하는 보조 스크립트. doctor와 같은 repo-local toolchain fallback을 Bubblewrap 실행 PATH에도 적용한다
- `scripts/check-android-role-apks.mjs`: `.data/mobile-builds/role-apks-20260617/role-apk-build-report.json`의 역할별 APK 4개, 현재 워크스페이스 경로, SHA-256/크기, assetlinks 역할 coverage를 검증하고 stale 절대경로는 `--write`로 정규화
- `scripts/check-android-release-handoff.mjs`: APK/AAB, doctor report, assetlinks/build-plan, signing custody, 주소창/공유/더보기 브라우저 UI 비노출을 포함한 기기 설치 smoke, 승인 증빙 manifest 검증
- `scripts/create-android-release-handoff-draft.mjs`: Android 산출물에서 release handoff 초안의 파일 해시와 크기 자동 생성
- `mobile/android-cap`: 주소창 없는 내부 설치 APK를 만드는 Capacitor Android WebView 프로젝트
- `scripts/generate-android-launcher-assets.mjs`: `public/icons/final-judo-icon-512.png` 검정 FINAL 심볼 PNG를 원본으로 Capacitor/TWA 런처 아이콘, adaptive foreground, splash PNG를 같은 이미지에서 재생성
- `scripts/build-android-capacitor-apk.mjs`: `FINAL_JUDO_ANDROID_SERVER_URL` 또는 `--url`을 Capacitor `server.url`로 sync하고 debug APK를 생성해 `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/INSTALL_ONLY_final-judo-native-webview-debug.apk`, 동등본 `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/final-judo-native-webview-debug.apk`, 데스크톱 복사본을 만든다. 리포트와 `INSTALL_ANDROID_WEBVIEW_APK.txt`에는 설치 전 기존 패키지 삭제 안내, 설치해야 할 단일 APK, 설치 금지 TWA/Bubblewrap 경로, 상단 브라우저 URL 바가 보일 때 잘못된 TWA/Custom Tab 산출물을 설치했다는 진단도 남긴다. 이미 TWA APK 출력 폴더가 있으면 `DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt` 마커를 함께 남겨 `app-debug.apk` 오설치를 막는다. 또한 APK 내부 `res/mipmap-xxxhdpi-v4/ic_launcher.png`를 추출한 `icon-proof/apk-ic_launcher-xxxhdpi.png`와 SHA-256을 기록해 실제 설치 파일의 런처 아이콘이 검정 FINAL 심볼 리소스와 일치하는지 증명한다
- `mobile/android/release-handoff.template.json`: Android 파일럿 배포 handoff manifest 템플릿
- `.github/workflows/android-twa.yml`: 운영 origin/릴리즈 지문을 입력받아 CI에서 doctor, TWA 입력 파일 생성, 선택적 APK/AAB 빌드, artifact 업로드를 수행하는 수동 workflow
- `npm run test:android-packaging`: release 체인에 포함되는 패키징 준비 검증
- `npm run test:android-play-release-artifacts`: 최신 Play release report와 Desktop AAB/APK 복사본, Gradle 버전, Android Capacitor 운영 URL, 서명 검증 파일을 대조해 업로드 파일 혼동 차단
- `npm run test:android-role-apks`: 이미 생성된 역할별 Android APK 4개가 현재 워크스페이스 산출물과 일치하는지 검증
- `npm run android:twa:doctor`: 로컬/CI Android TWA 빌드 준비 상태 점검
- `npm run android:release-handoff:draft`: Android 산출물 기반 handoff 초안 생성
- `npm run android:release-handoff`: 실제 Android APK/AAB 배포 handoff manifest 검증
- `npm run test:android-release-handoff-draft`: handoff 초안 생성기의 해시/크기 자동 입력 회귀 테스트
- `npm run test:android-release-handoff`: handoff 검증기의 ready/blocked fixture 회귀 테스트
- `npm run android:icons`: Android Capacitor/TWA 런처와 splash 이미지를 `public/icons/final-judo-icon-512.png` 기준으로 재생성
- `npm run android:twa:prepare`: 운영 도메인 기준 TWA 입력 파일 생성
- `npm run android:twa:build`: 로컬 JDK/Android SDK/Bubblewrap 환경에서 APK/AAB 빌드 시도
- `npm run android:cap:build`: 내부 설치용 주소창 없는 Capacitor WebView debug APK 생성
- `npm run android:play:build`: Play Console 업로드용 Capacitor release AAB/APK 생성

## APK/AAB 생성 전 필수 조건

1. 운영 Next 앱을 실제 HTTPS 도메인에 배포한다. 예시 명령의 `https://app.finaljudo.kr`는 형식 예시이며, 실행 전 확정된 운영 도메인으로 바꾼다.
2. `https://<운영도메인>/manifest.webmanifest`가 현재 PWA manifest를 반환해야 한다.
3. `https://<운영도메인>/.well-known/assetlinks.json`에 릴리즈 키 SHA-256 지문이 들어간 Digital Asset Links를 배포한다.
4. 로컬 `.data/toolchains` fallback 또는 CI에 JDK, Android SDK, Bubblewrap 실행 환경을 준비한다.
5. 릴리즈 keystore는 저장소에 커밋하지 않고 안전한 비밀 저장소에서 관리한다.
6. Play Console에 올린 적 있는 패키지는 `mobile/android-cap/app/build.gradle`의 `versionCode`를 이전 업로드보다 크게 올린 뒤 새 AAB를 만든다.

## 실행 예시

```bash
npm run test:android-packaging

npm run test:android-play-release-artifacts

npm run test:android-role-apks

npm run android:icons

npm run android:twa:doctor

npm run android:twa:doctor -- \
  --origin=https://app.finaljudo.kr \
  --sha256=<release-signing-sha256-fingerprint> \
  --out=.data/android-twa-doctor.json \
  --markdown=.data/android-twa-doctor.md

npm run android:twa:doctor -- --strict \
  --origin=https://app.finaljudo.kr \
  --sha256=<release-signing-sha256-fingerprint>

npm run android:twa:prepare -- \
  --origin=https://app.finaljudo.kr \
  --sha256=<release-signing-sha256-fingerprint>

npm run android:twa:build -- \
  --origin=https://app.finaljudo.kr \
  --sha256=<release-signing-sha256-fingerprint>

npm run android:cap:build -- \
  --url=https://final-judo.vercel.app/login

npm run android:play:build -- \
  --url=https://final-judo.vercel.app/login

npm run android:release-handoff:draft -- \
  --doctor=.data/android-twa-doctor.json \
  --assetlinks=mobile/android/generated/assetlinks.json \
  --build-plan=mobile/android/generated/build-plan.json \
  --apk=mobile/android/twa/app-release-signed.apk \
  --aab=mobile/android/twa/app-release-bundle.aab \
  --out=.data/android-release-handoff.json

npm run android:release-handoff -- \
  --file=.data/android-release-handoff.json \
  --out=.data/android-release-handoff.report.json
```

`android:twa:doctor`는 기본 모드에서 현재 blockers를 JSON으로 보고하고 exit 0으로 끝난다. `--markdown=.data/android-twa-doctor.md`를 함께 넘기면 담당자에게 바로 공유할 수 있는 점검표와 macOS/환경변수/CI 설치 힌트도 생성한다. 그래서 `test:release` 안에서는 운영 origin/서명 지문/Android toolchain 준비 상태를 명확히 보여주는 준비 상태표로 사용한다. 로컬에서는 환경변수가 비어 있어도 `.data/toolchains/jdk`, `.data/toolchains/android-sdk`를 fallback으로 확인해 Java/SDK 준비 상태를 과잉 blocker로 잡지 않는다. 실제 APK/AAB 생성 직전에는 `--strict`를 붙여 하나라도 빠진 조건이 있으면 실패하게 하고, `--out=.data/android-twa-doctor.json --markdown=.data/android-twa-doctor.md` 결과를 릴리즈 증빙으로 보관한다.

`android:twa:doctor`, `android:twa:prepare`, `android:twa:build`, `android:release-handoff`는 `localhost`, `.example`, `.test`, `.local`, `TODO`, `TBD`, `placeholder`, `<https-origin>` 같은 예시/임시 origin을 실제 운영 origin으로 인정하지 않는다. 또한 TWA origin은 API base URL이 아니라 `/login`과 `/app/dashboard`를 서빙하는 웹앱 origin이어야 하므로 `api.*` 호스트는 기본 차단한다. API 호스트가 실제 웹앱도 함께 서빙한다는 운영자 확인이 있을 때만 `--allow-api-origin-webapp`을 붙여 예외 처리한다. 운영 도메인이 확정되기 전에는 APK/AAB 산출을 진행하지 않고 blocked 리포트로 남긴다.

`android:twa:prepare`는 `mobile/android/generated/` 아래에 `bubblewrap-manifest.json`, `assetlinks.json`, `build-plan.json`을 만든다. `assetlinks.json`은 운영 도메인의 `/.well-known/assetlinks.json`으로 배포해야 한다. 이 단계는 APK/AAB를 만들지 않으므로 JDK/Android SDK가 없어도 입력 파일을 생성하지만, 출력 JSON의 `buildReady`와 `buildBlockers`에는 Java, keytool, sdkmanager, adb, npx, `ANDROID_HOME`/`ANDROID_SDK_ROOT` 또는 repo-local `.data/toolchains` 준비 상태가 남는다.

설치 APK에서 상단에 `final-judo.vercel.app` 같은 Chrome 주소창, 공유 버튼, 더보기 버튼이 보이면 앱이 네이티브 WebView가 아니라 TWA/Custom Tab 경로로 열린 것이다. 이 설치본은 사용자 체감상 브라우저처럼 보이므로 현장 배포용으로 쓰지 않는다.

주소창 없는 내부 설치 파일은 다음 명령으로 만든다.

```bash
npm run android:cap:build -- \
  --url=https://final-judo.vercel.app/login
```

생성 파일:

- `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/INSTALL_ONLY_final-judo-native-webview-debug.apk`
- `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/final-judo-native-webview-debug.apk` (동등본)
- `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/icon-proof/apk-ic_launcher-xxxhdpi.png`
- `.data/mobile-builds/android-capacitor-webview-<yyyymmdd>/INSTALL_ANDROID_WEBVIEW_APK.txt`
- `~/Desktop/INSTALL_ONLY_final-judo-native-webview-debug.apk`
- `~/Desktop/final-judo-native-webview-debug.apk`
- `~/Desktop/final-judo-native-webview-debug-INSTALL.txt`

현장 설치자는 `INSTALL_ONLY_final-judo-native-webview-debug.apk`만 설치한다. `final-judo-native-webview-debug.apk`는 같은 해시의 동등본으로 남지만, 현장 전달용으로는 `INSTALL_ONLY_` 파일명을 우선한다. 아래 경로는 파일명이 `app-debug.apk`라 헷갈리기 쉽지만 TWA/Bubblewrap 산출물이므로 내부 현장 검증 APK로 설치하지 않는다.

- `mobile/android/twa/app/build/outputs/apk/debug/app-debug.apk`

Play Console 업로드용 release AAB/APK는 다음 명령으로 만든다. 이 명령은 `versionCode`가 `.data/mobile-builds`에 남은 최근 Play 빌드 리포트보다 크지 않으면 실패하므로, 재업로드 전 중복 versionCode를 먼저 막는다.

```bash
npm run android:play:build -- \
  --url=https://final-judo.vercel.app/login
```

생성 파일:

- `.data/mobile-builds/android-play-release-<timestamp>/final-judo-play-release.aab`
- `.data/mobile-builds/android-play-release-<timestamp>/final-judo-release.apk`
- `.data/mobile-builds/android-play-release-<timestamp>/google-play-release-report.json`
- `~/Desktop/final-judo-play-release.aab`
- `~/Desktop/final-judo-release.apk`

빌드 후에는 다음 검증으로 Desktop 업로드 파일과 timestamped 산출물이 같은 파일인지 확인한다.

```bash
npm run test:android-play-release-artifacts
```

이 검증은 최신 `google-play-release-report.json`의 `versionCode`/`versionName`, `https://final-judo.vercel.app/login` 실행 URL, AAB/APK byte size와 SHA-256, `~/Desktop/final-judo-play-release.aab`, `~/Desktop/final-judo-release.apk`, jarsigner/apksigner 검증 파일, APK badging, AAB 내부 TWA/Custom Tabs 런타임 미포함을 대조한다.

아래 TWA/Bubblewrap 산출물은 Play release WebView 산출물이 아니므로 현장 설치 APK나 Play upload 파일로 혼용하지 않는다.

- `mobile/android/twa/app/build/outputs/apk/release/app-release-unsigned.apk`
- `mobile/android/twa/**/*.apk`

TWA APK 출력 폴더에 `DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt`가 있으면 그 폴더의 APK는 현장 WebView 검증용으로 설치하지 않는다.

동일한 packageId의 이전 APK가 다른 서명키로 설치되어 있으면 Android가 업데이트 설치를 거부할 수 있다. 이때는 기존 `파이널유도멀티짐` 앱을 삭제한 뒤 새 APK를 설치한다. 운영 배포에서는 여전히 release signing SHA-256이 들어간 `assetlinks.json`을 도메인에 배포해 TWA 검증 또는 release-signed Capacitor 빌드 handoff를 통과해야 한다.

`android:twa:build`는 위 `buildBlockers`가 모두 해소된 경우에만 Bubblewrap init/build를 실행한다. 이 가드는 macOS의 `/usr/bin/java` shim처럼 명령은 있어도 실제 JRE가 없는 상태, Android SDK home 미설정, adb/platform-tools 누락을 빌드 시작 전에 차단한다. 로컬 fallback이 확인되면 해당 JDK/SDK 경로를 `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `PATH`에 반영해 Bubblewrap 실행에도 같은 toolchain을 사용한다.

## GitHub Actions 패키징 경로

GitHub Actions 탭에서 **Android TWA Package** workflow를 수동 실행한다.

입력값:

- `production_origin`: 실제 운영 HTTPS 웹앱 origin. `localhost`, `.example`, `TODO`, API-only `api.*` 값은 strict doctor에서 차단된다.
- `release_sha256`: release signing certificate SHA-256 fingerprint
- `build_artifacts`: 기본값 `false`. `false`면 strict doctor와 TWA 입력 파일 생성/업로드까지만 수행하고, `true`면 Bubblewrap APK/AAB 빌드까지 시도한다.

workflow는 Node.js 24, JDK 17, GitHub-hosted Ubuntu Android SDK 도구를 사용한다. 산출물 `final-judo-android-twa`에는 `.data/android-twa-doctor.json`, `mobile/android/generated/**`, 그리고 빌드가 생성한 `mobile/android/twa/**/*.apk`, `mobile/android/twa/**/*.aab`가 포함된다. APK/AAB를 실제 배포하려면 Android signing key와 Play/App signing 정책을 확정하고, keystore 원본과 비밀번호는 GitHub Secrets 또는 별도 비밀 저장소에서만 관리한다.

## Android release handoff

역할별 파일럿 설치 APK는 `.data/mobile-builds/role-apks-20260617/role-apk-build-report.json`에 별도로 보관한다. 이 report는 `npm run test:android-role-apks`로 4개 역할 packageId, APK 해시/크기, signer verification, assetlinks package coverage, 현재 워크스페이스 경로를 검증한다. 프로젝트를 이동해 report 안에 오래된 절대경로가 남았을 때는 `npm run test:android-role-apks -- --write`로 report 경로를 현재 워크스페이스 기준 상대경로로 정규화한다. 이 검증은 파일럿 설치 산출물의 무결성 확인이며, Play Store/운영 release handoff ready 판정은 아니다.

실제 APK/AAB 산출물이 생긴 뒤에는 `npm run android:release-handoff:draft -- --out=.data/android-release-handoff.json`로 초안을 만든 뒤 운영 증빙 필드를 채운다. 수동으로 시작해야 할 때는 `mobile/android/release-handoff.template.json`을 복사해도 된다. 이 manifest는 다음 항목을 ready 조건으로 검증한다.

- `.data/android-twa-doctor.json`, `assetlinks.json`, `build-plan.json`, APK, AAB의 경로, byte size, SHA-256 해시
- `https://<운영도메인>/.well-known/assetlinks.json` 배포 확인과 증빙
- Play App Signing 또는 self-managed signing 결정, keystore custody, upload key owner, 저장소 미커밋 확인
- 설치된 Android 앱에서 로그인, 코치 출석 처리, 알림 권한 확인, 주소창/공유/더보기 브라우저 UI 비노출, 가로 overflow 없음 smoke 증빙
- 총괄 PM/운영 책임자 signoff

검증 명령:

```bash
npm run android:release-handoff -- \
  --file=.data/android-release-handoff.json \
  --out=.data/android-release-handoff.report.json
```

준비 중인 초안은 `--allow-pending`으로 blockers를 JSON으로 확인할 수 있지만, 파일럿 배포 직전 strict handoff는 blockers가 없어야 한다.

## 현재 로컬 상태

2026-07-21 기준 내부 설치용 Capacitor WebView debug APK와 Play Console 비공개 테스트용 Capacitor release AAB/APK는 로컬에서 생성되어 있다.

- `.data/mobile-builds/android-capacitor-webview-20260629/INSTALL_ONLY_final-judo-native-webview-debug.apk`
- `.data/mobile-builds/android-capacitor-webview-20260629/final-judo-native-webview-debug.apk` (동등본)
- `~/Desktop/INSTALL_ONLY_final-judo-native-webview-debug.apk`
- `~/Desktop/final-judo-native-webview-debug.apk`

Play Console 업로드용 최신 로컬 산출물:

- `.data/mobile-builds/android-play-release-20260723180145/final-judo-play-release.aab`
- `.data/mobile-builds/android-play-release-20260723180145/final-judo-release.apk`
- `.data/mobile-builds/android-play-release-20260723180145/google-play-release-report.json`
- `~/Desktop/final-judo-play-release.aab`
- `~/Desktop/final-judo-release.apk`
- `versionCode 43`, `versionName 1.0.42`, package `kr.co.finaljudo.multigym`, launch URL `https://final-judo.vercel.app/login`
- AAB SHA-256 `397eb654947e01e2bf8886d31b14b4aa973023d9ed8846cc82a499927499e999`, APK SHA-256 `0df37504a2013e5be51226a27ced577aabf0100964159bb21e1a26a590e3b86b`
- 배포 대상 alias: `https://final-judo.vercel.app`

이 APK는 `capacitor-native-webview` 패키징 리포트에서 `kr.co.finaljudo.multigym.MainActivity` 실행, 요청한 `server.url`, TWA/Custom Tabs 런타임 미포함, debug signing 검증을 통과했다. Android 상단에 `final-judo.vercel.app` URL 바, 공유 버튼, 더보기 버튼이 보이면 이 WebView APK가 아니라 TWA/Custom Tab 또는 브라우저 경로 산출물이 설치된 것이다.

Android 런처 아이콘과 splash는 `npm run android:icons`로 `public/icons/final-judo-icon-512.png`의 검정 FINAL 심볼 PNG에서만 생성한다. Capacitor/TWA mipmap 리소스, adaptive foreground, splash, `mobile/android/twa/store_icon.png`까지 같은 PNG 원본에서 갱신하며, PWA manifest와 metadata는 Android 설치 아이콘으로 stale SVG 경로를 우선 노출하지 않는다. `mobile/android-cap/app/src/main/res/drawable/ic_launcher_background.xml`, `mobile/android-cap/app/src/main/res/drawable-v24/ic_launcher_foreground.xml` 같은 Capacitor 기본 템플릿 벡터 아이콘은 제거되어 있어야 하며, `npm run test:android-packaging`이 SVG 대체 아이콘 또는 예전 템플릿 아이콘 회귀를 차단한다. 내부 설치 APK를 만들면 `android-capacitor-webview-report.json`의 `launcherIcon` 필드와 `icon-proof/apk-ic_launcher-xxxhdpi.png`가 APK 내부 아이콘까지 같은 SHA-256인지 남기고, `npm run test:mobile-install`이 이 값을 다시 검증한다. `mobile/android/twa/app-release-signed.apk`처럼 과거 TWA 루트 산출물은 주소창/낡은 아이콘 오설치 위험이 있으므로 현장 설치 대상이 아니며, `DO_NOT_INSTALL_FOR_FIELD_WEBVIEW.txt`와 설치 가이드가 `INSTALL_ONLY_final-judo-native-webview-debug.apk`만 설치하도록 안내한다.

운영 Play Store/AAB 릴리즈는 여전히 별도 blocked 상태다. 실제 운영 HTTPS 웹앱 origin, release signing SHA-256 fingerprint, 운영 도메인의 Digital Asset Links 배포 확인, release signing custody, 주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 설치 smoke, Android release handoff signoff가 채워져야 운영 배포 ready로 볼 수 있다.
