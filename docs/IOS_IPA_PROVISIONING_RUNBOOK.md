# iOS IPA 배포/provisioning 런북

작성일: 2026-08-05
목적: Simulator 실행, Development/Ad Hoc 설치, App Store Connect 배포를 구분하고 선택한 export method에 맞는 서명·프로파일·업로드 증빙을 확인한다.

## 현재 기준값

- Apple 계정: `roehf45@naver.com`
- Apple Team ID: `CA7A5SP5G5`
- iOS bundle id: `kr.co.finaljudo.multigym`
- Xcode project: `mobile/ios/App/App.xcodeproj`
- export method: `app-store-connect`
- provisioning profile 설치 위치:
  - `~/Library/MobileDevice/Provisioning Profiles`
  - `~/Library/Developer/Xcode/UserData/Provisioning Profiles`
- doctor 산출물: `.data/mobile-builds/ios/ios-ipa-doctor.json`, `.data/mobile-builds/ios/ios-ipa-doctor.md`
- build report 산출물: `.data/mobile-builds/ios/ios-ipa-build-report.json`
- App Store 업로드 증빙: `.data/mobile-builds/ios/app-store/<version-build>/upload-result.md`

## 배포 방식별 요구사항

- `app-store-connect`: Apple Distribution 인증서와 App Store 배포용 provisioning profile이 필요하다. 테스트 기기 UDID는 필요하지 않는다.
- `development`, `debugging`, `release-testing`: 등록된 실제 iPhone UDID가 포함된 개발용 provisioning profile이 필요하다.
- `ad-hoc`: 등록된 실제 iPhone UDID가 포함된 Ad Hoc provisioning profile이 필요하다.
- `enterprise`: 조직의 In-House 배포 권한과 enterprise profile이 필요하다.

UDID 원문은 git, 문서, `.data` report, 채팅 요약에 기록하지 않는다.

## ready로 보지 않는 상태

- Simulator에서 앱 실행만 성공한 상태.
- `FINAL_JUDO_IOS_SERVER_URL` 또는 `--origin`이 `/login`과 `/app/dashboard`를 제공하는 운영 HTTPS 웹앱이 아닌 상태.
- Apple Team ID, bundle id, export method와 matching provisioning profile이 없는 상태.
- archive/export 또는 App Store Connect 업로드 성공 증빙이 없는 상태.
- `https://api.finaljudo.co.kr`처럼 API 전용 origin만 지정한 상태. 실제 웹앱도 제공한다는 운영자 확인이 있을 때만 `--allow-api-origin-webapp`을 사용한다.

## App Store Connect 배포 순서

1. 운영 HTTPS 웹앱 origin에서 `/login`과 `/app/dashboard`가 열리는지 확인한다.
2. Apple Developer에서 Team ID `CA7A5SP5G5`, bundle id `kr.co.finaljudo.multigym`에 맞는 App Store 배포용 profile을 만든다.
3. Xcode Settings > Accounts에서 `roehf45@naver.com` 계정을 선택하고 Download Manual Profiles를 실행한다. 받은 `.mobileprovision` 파일을 직접 열어 설치할 수도 있다.
4. strict doctor를 실행한다.

```bash
APPLE_TEAM_ID=CA7A5SP5G5 FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:doctor -- --team-id=CA7A5SP5G5 --xcode-export-method=app-store-connect --strict --out=.data/mobile-builds/ios/ios-ipa-doctor.json --markdown=.data/mobile-builds/ios/ios-ipa-doctor.md
```

5. doctor가 통과하면 archive와 IPA를 생성한다.

```bash
APPLE_TEAM_ID=CA7A5SP5G5 FINAL_JUDO_IOS_SERVER_URL=https://<webapp-origin> npm run ios:ipa:build -- --team-id=CA7A5SP5G5 --xcode-export-method=app-store-connect --allow-provisioning-updates
```

6. App Store Connect 업로드 결과에서 bundle id, 버전, build, codesign 확인, IPA SHA-256, `Upload succeeded`를 보관한다.
7. P1 상태를 갱신한다.

```bash
npm run p1:operator-status -- --workspace=.data --allow-pending --out=.data/p1-operator-status.json --markdown=.data/p1-operator-status.md
npm run p1:completion-evidence -- --workspace=.data --allow-pending --out=.data/p1-completion-evidence.json --markdown=.data/p1-completion-evidence.md --csv=.data/p1-completion-evidence.csv
npm run p1:readiness -- --workspace=.data --allow-pending --out=.data/p1-readiness.json --markdown=.data/p1-readiness.md
```

## 현재 확인 상태

- doctor는 Team ID `CA7A5SP5G5`, bundle id `kr.co.finaljudo.multigym`, `app-store-connect` 호환 profile을 확인했다.
- App Store Connect 업로드는 버전 `1.0`, build `1`로 성공했다.
- iOS 배포 요구사항은 P1 readiness에서 `ready`다. 운영 배포, Android handoff, 결제 provider, 운영 푸시, 이슈 등록, 파일럿 최종 상태는 별도 blocker다.
- Simulator 성공이나 iOS 업로드 성공만으로 전체 운영 ready 또는 출시 완료를 선언하지 않는다.

## 증빙 보관 규칙

- 보관: doctor JSON/Markdown, build report, upload result, IPA SHA-256, Apple Developer 또는 App Store Connect 확인 결과.
- 금지: Apple 계정 비밀번호, 인증서 private key, 원문 UDID, 세션·업로드 토큰.
- profile UUID는 진단용 메타데이터일 뿐 secret 대체값으로 사용하지 않는다.
