# iOS IPA 실제 기기/provisioning 런북

작성일: 2026-06-18
목적: iOS Simulator 실행 성공을 IPA 배포 가능 상태로 오해하지 않고, 실제 iPhone 등록과 matching provisioning profile 준비부터 strict doctor와 IPA build까지 같은 순서로 확인한다.

## 현재 기준값

- Apple 계정: `roehf45@naver.com`
- Apple Team ID: `5GWZ792DWH`
- iOS bundle id: `kr.co.finaljudo.multigym`
- Xcode project: `mobile/ios/App/App.xcodeproj`
- provisioning profile 설치 위치: `~/Library/MobileDevice/Provisioning Profiles`
- doctor 산출물: `.data/mobile-builds/ios/ios-ipa-doctor.json`, `.data/mobile-builds/ios/ios-ipa-doctor.md`
- build report 산출물: `.data/mobile-builds/ios/ios-ipa-build-report.json`

## ready로 보지 않는 상태

- Simulator에서 앱 실행이 성공했어도 IPA ready가 아니다.
- Xcode와 Apple Development certificate가 있어도 실제 iPhone UDID가 Apple Developer Devices에 등록되지 않았으면 IPA ready가 아니다.
- Team ID와 bundle id가 맞아도 matching provisioning profile이 로컬에 설치되지 않았으면 IPA ready가 아니다.
- `FINAL_JUDO_IOS_SERVER_URL` 또는 `--origin`이 실제 운영 웹앱 `https://<webapp-origin>` 값이 아니면 IPA ready가 아니다.
- `https://api.finaljudo.co.kr`처럼 `api.*`로 보이는 API 전용 origin은 앱 화면 origin으로 인정하지 않는다. 실제로 `/login`과 `/app/dashboard`를 서빙한다는 운영자 확인이 있을 때만 `--allow-api-origin-webapp`을 붙여 예외 처리한다.

## 운영자가 해야 할 순서

1. 운영 HTTPS 웹앱 origin을 확정한다.
   - `FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin>` 형태로 전달한다.
   - 이 값은 API base URL이 아니라 iOS WebView가 직접 열 웹앱 origin이어야 한다.
   - `/login`과 `/app/dashboard`가 실제로 열리는지 확인한다.
   - 예시/임시 origin은 P1 readiness 증빙으로 쓰지 않는다.
2. 실제 iPhone UDID를 Apple Developer에 등록한다.
   - Apple Developer > Certificates, Identifiers & Profiles > Devices에서 실제 테스트 iPhone을 추가한다.
   - UDID 원문은 git, 문서, `.data` report, 채팅 요약에 기록하지 않는다.
3. bundle id와 Team ID가 일치하는 provisioning profile을 만든다.
   - profile은 `5GWZ792DWH` 팀과 `kr.co.finaljudo.multigym` bundle id에 매칭되어야 한다.
   - 등록된 iPhone UDID가 포함된 iOS App Development 또는 Ad Hoc provisioning profile이어야 한다.
4. profile을 로컬에 설치한다.
   - Xcode Settings > Apple Accounts > `roehf45@naver.com` > Download Manual Profiles를 실행한다.
   - 또는 받은 `.mobileprovision` 파일을 열어 `~/Library/MobileDevice/Provisioning Profiles`에 설치한다.
5. strict doctor를 실행한다.

```bash
APPLE_TEAM_ID=5GWZ792DWH FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=5GWZ792DWH --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md
```

6. strict doctor가 통과한 뒤에만 IPA build를 실행한다.

```bash
APPLE_TEAM_ID=5GWZ792DWH FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:build -- --team-id=5GWZ792DWH --xcode-export-method=release-testing --allow-provisioning-updates
```

7. build report와 P1 상태판을 갱신한다.

```bash
npm run p1:operator-status -- --workspace=.data --allow-pending --out=.data/p1-operator-status.json --markdown=.data/p1-operator-status.md --external-blockers-csv=.data/p1-operator-status-external-blockers.csv
npm run p1:completion-evidence -- --workspace=.data --allow-pending --out=.data/p1-completion-evidence.json --markdown=.data/p1-completion-evidence.md --csv=.data/p1-completion-evidence.csv
npm run p1:readiness -- --workspace=.data --allow-pending --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md
```

## 현재 예상 차단 사유

- 운영 웹앱 `https://<webapp-origin>` 값이 아직 확정 증빙으로 들어오지 않았다.
- 로컬 `~/Library/MobileDevice/Provisioning Profiles`에 Team ID, bundle id, 등록 기기가 모두 맞는 matching provisioning profile이 없다.
- `.data/mobile-builds/ios/ios-ipa-build-report.json`은 Simulator 성공이 아니라 IPA archive/export 결과를 기준으로 판단해야 한다.

## 증빙 보관 규칙

- 보관할 것: doctor JSON/Markdown, IPA build report, provisioning profile 설치 확인 결과, Apple Developer 등록 완료 증빙 URL 또는 provider URI, P1 readiness/operator/completion 산출물.
- 보관하지 말 것: 실제 iPhone UDID 원문, Apple 계정 비밀번호, certificate private key, profile UUID를 secret처럼 쓰는 내부 값.
- 최종 P1 ready 판단은 `npm run p1:readiness` strict 결과와 7개 외부 blocker 증빙이 모두 ready일 때만 가능하다.
