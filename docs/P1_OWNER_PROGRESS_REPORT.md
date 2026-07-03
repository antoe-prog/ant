# P1 대표 진행 보고서

보고 기준일: 2026-06-16
대상: 비개발자 대표 공유용
현재 판단: 기능 개발 완료, 운영 전 외부 준비 대기

## 비개발자 대표에게 전달할 한 줄

파이널 유도 멀티짐 웹앱은 MVP 기능 개발 완료 상태이며, 현재는 파일럿 운영 및 앱 배포 전 최종 준비 단계입니다.

## 현재 단계

현재 단계는 "새로 만드는 단계"가 아니라 "실제 지점에서 안전하게 쓰기 전 검증과 외부 운영 준비를 채우는 단계"입니다.

개발팀 기준으로는 P0 MVP와 P1 내부 구현/검증 흐름이 준비되어 있습니다. 핵심 기능은 이미 구현되어 있으며 남은 항목은 운영 배포, Android release, iOS IPA 실기기/provisioning, 결제사, 푸시 알림, 담당자 handoff, 파일럿 현장 증빙처럼 실제 운영에 필요한 외부 준비입니다.

## 완료된 것

- 역할별 로그인과 권한 구분
- 회원, 학부모, 코치, 대표, 총괄 어드민 주요 화면
- 코치 모바일 출석 체크
- 회원/학부모 수업, 출석, 결제 상태 확인
- 대표 지점 현황, 운영 지표, 기간별 리포트
- 총괄 어드민 사용자, 지점, 권한, 시스템 설정, 감사 로그 관리
- 모바일 반응형 화면과 PWA 설치 흐름
- 공지 읽음/중요 표시, 알림 준비 흐름
- 결제 상태 이력, 환불/취소/정기결제 준비 흐름
- 파일럿 운영 체크리스트, 릴리즈 체크리스트, QA 문서
- GitHub 연결과 P1 handoff 산출물 관리 흐름
- 대표 공유용 진행 보고서와 briefing package 생성 흐름

## 남은 외부 준비

아래 항목은 개발 미완성이 아니라 운영 전 외부 준비입니다.

요약하면 운영 서버/도메인, PostgreSQL 운영 DB, Android APK/AAB, iOS 실제 iPhone 등록과 provisioning profile, 결제사, 푸시 알림, 파일럿 지점 증빙을 채워야 합니다.

| 구분 | 담당 lane | 필요한 증빙 | 현재 상태 |
| --- | --- | --- | --- |
| 운영 배포 handoff | DevOps/총괄 PM | 운영 HTTPS origin, 배포 플랫폼 secret store, production preflight/release report | 대기 |
| Android release handoff | Android/Release | 운영 HTTPS 웹앱 origin, release SHA-256 fingerprint, APK/AAB artifact, 주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 smoke | 대기 |
| iOS IPA build/provisioning | iOS/Release | 운영 HTTPS 웹앱 origin, Apple Team ID, 등록된 iPhone UDID, matching provisioning profile, IPA archive/export report | 대기 |
| 결제 provider handoff | Backend/Data | PG/VAN 계약, checkout/webhook mapping, billing key custody, 영수증 URL | 대기 |
| 운영 푸시 handoff | Frontend/QA | VAPID secret store, Android 기기 구독/수신/클릭, 공지 발송 감사 로그 | 대기 |
| P1 handoff issue registration receipt | Product Lead/QA | GitHub/Slack issue URL, 담당자 acknowledgement, issue body SHA-256 | 대기 |
| 파일럿 최종 status | Product Lead/현장 운영 | 실제 지점/계정, 14일 운영 로그, 스크린리더/모바일 출석 증빙, archive/storage receipt | 대기 |

## 대표 확인/결정 필요

- 파일럿을 진행할 실제 지점과 시작일
- 운영 도메인과 배포 환경
- 결제사를 실제로 붙일 시점과 담당자
- Android 앱을 먼저 배포할지, PWA 파일럿 후 APK/AAB를 만들지
- iOS IPA 배포를 진행할 실제 iPhone 기기 등록, provisioning profile 생성, Apple Team 담당자
- 파일럿 현장 담당자와 장애 보고 채널
- 운영 배포 handoff 증빙 담당자와 완료 예정일
- Android release handoff 증빙 담당자와 완료 예정일
- iOS IPA/provisioning 증빙 담당자와 완료 예정일
- 결제 provider handoff 증빙 담당자와 완료 예정일

## 다음 진행 순서

1. 운영 secret store, production preflight, 배포 URL, signoff 증빙을 채웁니다.
2. Android 운영 HTTPS 웹앱 origin, release SHA-256, JDK/Android SDK, APK/AAB 산출물을 준비합니다.
3. iOS 실제 iPhone UDID를 Apple Developer에 등록하고 `kr.co.finaljudo.multigym` provisioning profile을 생성합니다.
4. 실 PG/VAN 계약, checkout, webhook 서명/idempotency, billing key 보관 증빙을 채웁니다.
5. 운영 VAPID public/private key와 mailto subject를 배포 환경에 설정합니다.
6. 담당자 전달/acknowledgement가 완료된 뒤에만 GitHub 또는 Slack 외부 이슈 등록을 진행합니다.
7. 파일럿 준비, 비밀번호 교체, 현장 증빙, archive/storage/final handoff 산출물을 채웁니다.
8. 모든 외부 blocker 해소 후 P1 readiness와 completion evidence를 strict 모드로 다시 실행합니다.
9. 최종 release package, archive, storage receipt를 생성해 배포 판단을 마무리합니다.

## 과장해서 말하지 말 것

- "운영 오픈 완료"가 아니라 "운영 전 최종 준비 단계"입니다.
- "APK/AAB 생성 완료"가 아니라 "Android 패키징 전략과 검증 흐름 준비 완료, 실제 산출은 외부 빌드 환경 준비 후 진행"입니다.
- "iOS IPA 배포 가능"이 아니라 "iOS Simulator 실행과 IPA 배포 가능 상태를 분리했고, 실제 iPhone 등록/provisioning profile 증빙 대기"입니다.
- "결제사 실연동 완료"가 아니라 "결제/환불/정기결제 흐름과 provider-neutral 검증 완료, 실제 PG/VAN 증빙 대기"입니다.
- "푸시 알림 운영 완료"가 아니라 "푸시 구조와 검증 흐름 준비 완료, 운영 VAPID 키와 실기기 증빙 대기"입니다.

## 대표 보고 문안

대표님, 현재 핵심 기능 개발은 완료됐고 실제 운영에 필요한 검증과 배포 준비 단계에 들어갔습니다. 지금은 앱을 새로 만드는 단계가 아니라, 파일럿 지점에서 문제 없이 쓸 수 있도록 운영 DB, Android 앱 패키징, 결제/알림 설정, 배포 체크리스트를 정리하고 검증하는 단계입니다.

## 자동 생성 산출물

- 현재 상태 기반 대표 보고 초안: `.data/p1-owner-progress-report.md`
- 대표 공유 패키지 manifest: `.data/p1-owner-briefing-package.json`
- 대표 공유 패키지 폴더: `.data/p1-owner-briefing-package`
- P1 운영자 상태판: `.data/p1-operator-status.md`
- P1 완료 기준 매트릭스: `.data/p1-completion-evidence.md`
