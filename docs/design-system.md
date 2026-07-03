# 파이널 유도 멀티짐 디자인 시스템 초안

버전: `0.1.0`
작성일: `2026-06-13`
대상: 총괄 어드민, 대표, 코치, 회원, 학부모가 함께 쓰는 유도장 운영 웹앱

## 1. 디자인 원칙

파이널 유도 멀티짐 웹앱은 마케팅 페이지가 아니라 매일 반복해서 쓰는 운영 도구다. 첫 화면과 주요 컴포넌트는 장식보다 스캔, 입력 속도, 상태 판단을 우선한다.

- 빠른 판단: 출석, 결제, 회원 상태는 색상과 텍스트가 함께 보여야 한다.
- 낮은 피로도: 넓은 여백보다 조밀하지만 숨 쉬는 정보 구조를 쓴다.
- 실수 방지: 삭제, 환불, 권한 변경은 확인 단계와 감사 로그가 필요하다.
- 현장 친화: 태블릿과 작은 노트북에서도 출석 체크가 한 손에 들어와야 한다.
- 한국어 우선: 긴 한글 이름, 반명, 수업명, 보호자 연락처가 잘리지 않게 설계한다.

## 2. 토큰 네이밍

토큰은 `category.role.scale` 구조를 기본으로 한다.

예:

```text
color.brand.navy.700
color.semantic.danger.bg
space.4
radius.card
shadow.overlay
component.attendance.present.bg
```

CSS 변수로 옮길 때는 다음처럼 변환한다.

```css
--color-brand-navy-700: #1f4f7a;
--space-4: 16px;
--radius-card: 8px;
```

## 3. 컬러 토큰

### 3.1 Core Palette

유도장 운영 제품의 기본 인상은 `깨끗한 흰색`, `신뢰감 있는 네이비`, `도장 매트에서 온 그린`, `주의/결제 상태용 앰버`, `위험 액션용 레드` 조합으로 잡는다. 한 가지 색 계열에 묶이지 않도록 상태색은 명확히 분리한다.

| Token | Value | Use |
| --- | --- | --- |
| `color.neutral.0` | `#FFFFFF` | 최상위 표면, 카드 배경 |
| `color.neutral.50` | `#F7F9FB` | 앱 배경, 테이블 헤더 |
| `color.neutral.100` | `#EEF2F6` | 섹션 배경, disabled fill |
| `color.neutral.200` | `#D9E1EA` | 기본 border |
| `color.neutral.300` | `#B8C4D0` | 강한 border, divider |
| `color.neutral.500` | `#64748B` | 보조 텍스트 |
| `color.neutral.700` | `#334155` | 본문 텍스트 |
| `color.neutral.900` | `#111827` | 제목, 주요 수치 |
| `color.brand.navy.50` | `#EAF3FB` | 선택 행 배경 |
| `color.brand.navy.100` | `#CFE4F6` | 정보 배지 배경 |
| `color.brand.navy.500` | `#2F80C9` | primary hover |
| `color.brand.navy.600` | `#256DAA` | primary base |
| `color.brand.navy.700` | `#1F4F7A` | primary pressed, active nav |
| `color.brand.navy.900` | `#102A43` | 사이드바, 고대비 제목 |
| `color.brand.tatami.50` | `#EAF8F0` | 성공/출석 연한 배경 |
| `color.brand.tatami.500` | `#2EA66F` | 출석, 완료 |
| `color.brand.tatami.700` | `#1F7A4F` | 성공 텍스트 |
| `color.brand.beltRed.50` | `#FDECEC` | 위험 연한 배경 |
| `color.brand.beltRed.500` | `#D64545` | 결석, 삭제 |
| `color.brand.beltRed.700` | `#A83232` | 위험 텍스트 |
| `color.brand.gold.50` | `#FFF6DA` | 지각/대기 배경 |
| `color.brand.gold.500` | `#D99A00` | 지각, 주의 |
| `color.brand.gold.700` | `#946200` | 주의 텍스트 |
| `color.brand.cobalt.50` | `#EAF0FF` | 사유/정보 배경 |
| `color.brand.cobalt.500` | `#4D6FEA` | 정보 액션 |
| `color.brand.cobalt.700` | `#3448B5` | 정보 텍스트 |

### 3.2 Semantic Colors

| Token | BG | Border | Text | Use |
| --- | --- | --- | --- | --- |
| `color.semantic.primary` | `#EAF3FB` | `#8DC2EB` | `#1F4F7A` | 주요 액션, 선택 상태 |
| `color.semantic.success` | `#EAF8F0` | `#8AD9B2` | `#1F7A4F` | 출석, 저장 완료, 정상 결제 |
| `color.semantic.warning` | `#FFF6DA` | `#F1C65B` | `#946200` | 지각, 미납 임박, 확인 필요 |
| `color.semantic.danger` | `#FDECEC` | `#F2A3A3` | `#A83232` | 결석, 삭제, 환불, 오류 |
| `color.semantic.info` | `#EAF0FF` | `#A8B8FF` | `#3448B5` | 공지, 시스템 안내 |
| `color.semantic.neutral` | `#F7F9FB` | `#D9E1EA` | `#334155` | 대기, 비활성, 미선택 |

### 3.3 Attendance Colors

출석 상태는 색만으로 구분하지 않는다. 반드시 `아이콘 + 라벨 + 상태색` 조합으로 표시한다.

| Status | Token | BG | Border | Text | Icon |
| --- | --- | --- | --- | --- | --- |
| 미체크 | `attendance.pending` | `#F7F9FB` | `#D9E1EA` | `#64748B` | `CircleDashed` |
| 출석 | `attendance.present` | `#EAF8F0` | `#8AD9B2` | `#1F7A4F` | `Check` |
| 지각 | `attendance.late` | `#FFF6DA` | `#F1C65B` | `#946200` | `Clock3` |
| 결석 | `attendance.absent` | `#FDECEC` | `#F2A3A3` | `#A83232` | `X` |
| 사유 | `attendance.excused` | `#EAF0FF` | `#A8B8FF` | `#3448B5` | `FileCheck2` |
| 체험 | `attendance.trial` | `#E7FAF8` | `#82DCD3` | `#11756D` | `Sparkles` |

## 4. Typography

기본 폰트는 `Pretendard`를 권장한다. 없을 때는 `Noto Sans KR`, `Apple SD Gothic Neo`, system sans-serif 순서로 fallback한다.

```css
font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

| Token | Size | Line Height | Weight | Use |
| --- | ---: | ---: | ---: | --- |
| `type.display.sm` | `28px` | `36px` | `700` | 대시보드 페이지 제목 |
| `type.heading.lg` | `24px` | `32px` | `700` | 주요 화면 제목 |
| `type.heading.md` | `20px` | `28px` | `700` | 패널 제목 |
| `type.heading.sm` | `18px` | `26px` | `700` | 카드 제목 |
| `type.body.lg` | `16px` | `24px` | `400` | 본문 강조, 폼 입력 |
| `type.body.md` | `14px` | `22px` | `400` | 기본 UI 텍스트 |
| `type.body.sm` | `13px` | `20px` | `400` | 테이블 보조 정보 |
| `type.label.md` | `14px` | `20px` | `600` | 폼 라벨, 버튼 |
| `type.label.sm` | `12px` | `16px` | `600` | 배지, 테이블 헤더 |
| `type.metric.lg` | `32px` | `40px` | `700` | 대시보드 숫자 |
| `type.mono.sm` | `12px` | `16px` | `500` | 회원번호, 로그 ID |

타이포그래피 규칙:

- 글자 간격은 기본 `0`을 사용한다.
- 버튼, 배지, 테이블 헤더는 `label` 토큰을 사용한다.
- 금액은 `tabular-nums`를 적용해 열 정렬을 맞춘다.
- 긴 한글 회원명은 말줄임보다 2줄 허용을 우선한다.

## 5. Spacing

4px grid를 기본으로 한다.

| Token | Value | Use |
| --- | ---: | --- |
| `space.0` | `0` | reset |
| `space.1` | `4px` | 아이콘과 텍스트 사이 최소 간격 |
| `space.2` | `8px` | 버튼 내부 gap, 작은 필드 간격 |
| `space.3` | `12px` | 컴팩트 카드 padding |
| `space.4` | `16px` | 기본 섹션/카드 padding |
| `space.5` | `20px` | 폼 그룹 간격 |
| `space.6` | `24px` | 패널 간격 |
| `space.8` | `32px` | 페이지 블록 간격 |
| `space.10` | `40px` | 대형 섹션 간격 |
| `space.12` | `48px` | 모달 상하 여백 |

레이아웃 권장값:

- 페이지 좌우 padding: desktop `24px`, tablet `20px`, mobile `16px`
- 카드 내부 padding: default `16px`, dense `12px`
- 테이블 셀 padding: default `12px 16px`, dense `8px 12px`
- 폼 row gap: `16px`

## 6. Radius

운영 도구 느낌을 유지하기 위해 과한 둥근 모서리는 피한다.

| Token | Value | Use |
| --- | ---: | --- |
| `radius.none` | `0` | 테이블 내부 셀 |
| `radius.xs` | `2px` | focus ring offset, 작은 표시 |
| `radius.sm` | `4px` | 배지, 작은 컨트롤 |
| `radius.md` | `6px` | 버튼, 입력 |
| `radius.card` | `8px` | 카드, 패널, 토스트 |
| `radius.modal` | `8px` | 모달 |
| `radius.pill` | `999px` | pill badge, segmented control |

## 7. Elevation

그림자는 기능적 레이어 구분에만 쓴다. 카드 목록에는 기본적으로 border를 우선한다.

| Token | Value | Use |
| --- | --- | --- |
| `shadow.none` | `none` | 기본 카드, 테이블 |
| `shadow.raised` | `0 1px 2px rgba(16, 42, 67, 0.08)` | hover 가능한 카드 |
| `shadow.popover` | `0 8px 24px rgba(16, 42, 67, 0.14)` | dropdown, popover |
| `shadow.overlay` | `0 16px 40px rgba(16, 42, 67, 0.18)` | modal, drawer |
| `shadow.focus` | `0 0 0 3px rgba(47, 128, 201, 0.24)` | keyboard focus |

## 8. Interaction States

| State | Rule |
| --- | --- |
| `default` | 명확한 border와 텍스트 대비를 유지한다. |
| `hover` | 배경을 한 단계 진하게 하거나 border를 강조한다. |
| `pressed` | hover보다 더 진한 배경, shadow 제거. |
| `focus-visible` | `shadow.focus`와 2px offset을 적용한다. |
| `selected` | primary 또는 상태색 배경 + strong border. |
| `disabled` | opacity만 낮추지 말고 neutral bg/text로 명확히 비활성화한다. |
| `loading` | 버튼 폭은 유지하고 spinner와 라벨을 함께 둔다. |
| `error` | danger border + helper text + field icon을 함께 사용한다. |

## 9. Buttons

### 9.1 Variants

| Variant | Use | BG | Border | Text |
| --- | --- | --- | --- | --- |
| `primary` | 저장, 등록, 출석 확정 | `color.brand.navy.600` | same | `#FFFFFF` |
| `secondary` | 보조 액션, 다음 단계 | `#FFFFFF` | `color.neutral.300` | `color.neutral.900` |
| `outline` | 덜 중요한 페이지 액션 | transparent | `color.brand.navy.500` | `color.brand.navy.700` |
| `ghost` | 테이블 row action, toolbar | transparent | transparent | `color.neutral.700` |
| `danger` | 삭제, 환불, 권한 회수 | `color.brand.beltRed.500` | same | `#FFFFFF` |
| `success` | 출석 처리, 정상 완료 | `color.brand.tatami.500` | same | `#FFFFFF` |

### 9.2 Sizes

| Size | Height | Padding | Icon | Use |
| --- | ---: | --- | ---: | --- |
| `sm` | `32px` | `0 10px` | `16px` | 테이블 행 액션 |
| `md` | `36px` | `0 14px` | `18px` | 기본 버튼 |
| `lg` | `44px` | `0 18px` | `20px` | 주요 폼 제출, 모바일 |
| `icon` | `36px` | square | `18px` | toolbar icon button |

규칙:

- 아이콘 버튼은 tooltip을 제공한다.
- destructive 액션은 `danger` + 확인 모달을 기본으로 한다.
- 같은 영역의 primary 버튼은 하나만 둔다.
- 로딩 상태에서는 라벨을 유지한다. 예: `저장 중`

## 10. Inputs

### 10.1 Text Input

| Token | Value |
| --- | --- |
| height | `40px` |
| padding | `0 12px` |
| radius | `radius.md` |
| border | `1px solid color.neutral.300` |
| bg | `color.neutral.0` |
| text | `color.neutral.900` |
| placeholder | `color.neutral.500` |

상태:

- Focus: `border-color: color.brand.navy.500`, `shadow.focus`
- Error: `border-color: color.brand.beltRed.500`, helper text `color.semantic.danger.text`
- Disabled: `bg: color.neutral.100`, `text: color.neutral.500`
- Readonly: 배경은 흰색 유지, 우측에 lock icon 또는 `읽기 전용` helper 제공

### 10.2 Field Structure

```text
Label
[ input / select / date picker ]
Helper or validation text
```

규칙:

- 필수값은 라벨 옆 `필수` 배지로 표시한다.
- 전화번호, 생년월일, 금액은 포맷팅 입력을 제공한다.
- 보호자 연락처처럼 민감한 정보는 권한이 없으면 일부 masking한다.

## 11. Cards

카드는 반복 가능한 정보 단위에만 사용한다. 페이지 섹션 전체를 떠 있는 카드처럼 만들지 않는다.

| Part | Spec |
| --- | --- |
| container | `bg: white`, `border: 1px solid neutral.200`, `radius.card` |
| padding | default `16px`, dense `12px` |
| header | title + optional action |
| body | 핵심 데이터, 표, 리스트 |
| footer | secondary actions, timestamp |

Variants:

- `default`: border only
- `interactive`: hover border `brand.navy.300`, `shadow.raised`
- `status`: 좌측 3px status bar
- `metric`: 큰 숫자 + 변화량 + 기간 라벨

## 12. Tables

운영 웹앱의 핵심 컴포넌트다. 테이블은 많은 정보를 빠르게 비교할 수 있어야 한다.

| Element | Spec |
| --- | --- |
| header | `bg: neutral.50`, `type.label.sm`, sticky option |
| row height | default `48px`, dense `40px` |
| cell padding | default `12px 16px`, dense `8px 12px` |
| border | horizontal `neutral.200` |
| hover | `neutral.50` |
| selected | `brand.navy.50` + left indicator |
| sorted column | header text `brand.navy.700`, sort icon |

Table states:

- Loading: skeleton row 5개
- Empty: 간단한 원인 + primary action
- Error: inline alert + 재시도 버튼
- Bulk selected: 상단 bulk action bar

Column guidance:

- 회원명: 이름 + 띠/반 정보 2줄
- 연락처: 권한 없으면 `010-****-1234`
- 금액: 우측 정렬 + tabular nums
- 상태: badge 사용
- 액션: icon button 최대 3개, 나머지는 menu

## 13. Badges

| Variant | Use | Example |
| --- | --- | --- |
| `status.success` | 정상, 출석, 결제완료 | `정상` |
| `status.warning` | 미납임박, 지각, 확인필요 | `미납 임박` |
| `status.danger` | 결석, 미납, 정지 | `미납` |
| `status.info` | 체험, 공지 | `공지` |
| `status.neutral` | 대기, 비활성 | `대기` |
| `role` | 권한 표시 | `코치` |
| `belt` | 띠 단계 표시 | `파란띠` |

Badge spec:

- height: `22px`
- padding: `0 8px`
- radius: `radius.pill`
- font: `type.label.sm`
- icon: optional `12px`

띠 배지는 실제 띠 색과 텍스트 대비를 함께 고려한다. 흰띠는 border를 필수로 둔다.

## 14. Tabs

### 14.1 Underline Tabs

회원 상세, 결제 상세처럼 같은 리소스의 하위 정보를 나눌 때 사용한다.

| Spec | Value |
| --- | --- |
| height | `44px` |
| active text | `brand.navy.700` |
| active indicator | `2px solid brand.navy.600` |
| inactive text | `neutral.500` |
| hover bg | `neutral.50` |

### 14.2 Segmented Tabs

출석 목록의 `오늘 / 이번 주 / 이번 달`, 회원 목록의 `전체 / 활성 / 휴면`처럼 빠른 필터에 사용한다.

| Spec | Value |
| --- | --- |
| container bg | `neutral.100` |
| radius | `radius.pill` |
| item height | `32px` |
| active bg | `white` |
| active shadow | `shadow.raised` |

## 15. Modals

모달은 현재 작업을 멈추고 확인이 필요한 경우에만 사용한다. 일반 편집은 가능하면 drawer나 inline panel을 우선한다.

| Size | Width | Use |
| --- | ---: | --- |
| `sm` | `400px` | 삭제 확인, 간단한 경고 |
| `md` | `560px` | 단일 폼, 출석 메모 |
| `lg` | `720px` | 회원 등록, 결제 처리 |
| `xl` | `920px` | 복합 정보 확인 |

Spec:

- scrim: `rgba(17, 24, 39, 0.44)`
- container: `white`, `radius.modal`, `shadow.overlay`
- padding: header `20px 24px`, body `24px`, footer `16px 24px`
- close: 우상단 icon button
- focus: open 시 첫 interactive element, close 후 trigger로 반환

Destructive modal:

- 제목은 결과를 명확히 쓴다. 예: `회원을 삭제할까요?`
- 본문에 되돌릴 수 없는 영향과 관련 데이터 범위를 표시한다.
- confirm 버튼은 `danger`, cancel은 `secondary`.

## 16. Toasts

토스트는 작업 결과를 짧게 알려준다. 중요한 오류나 결제 실패는 toast만으로 끝내지 말고 화면 안에도 표시한다.

| Variant | Use | Duration |
| --- | --- | ---: |
| `success` | 저장, 출석 처리 완료 | `3000ms` |
| `info` | 동기화, 공지 안내 | `4000ms` |
| `warning` | 일부 실패, 확인 필요 | `5000ms` |
| `danger` | 저장 실패, 권한 없음 | 수동 닫기 또는 `7000ms` |

Spec:

- position: desktop `top-right`, mobile `bottom-center`
- width: desktop `360px`, mobile `calc(100vw - 32px)`
- radius: `radius.card`
- shadow: `shadow.popover`
- icon + title + optional description + close button

## 17. Permission Matrix

권한은 역할 기반 접근 제어와 행 단위 소유권을 함께 사용한다.

Legend:

- `Full`: 생성, 조회, 수정, 삭제 가능
- `Edit`: 생성/수정 가능, 삭제 제한
- `View`: 조회만 가능
- `Own`: 본인 담당 반/회원만 가능
- `Approve`: 승인 또는 상위 권한 필요
- `None`: 접근 불가

| Feature | 총괄 어드민 | 대표 | 코치 | 회원 | 학부모 |
| --- | --- | --- | --- | --- | --- |
| 전체 지점 관리 | Full | None | None | None | None |
| 지점 대시보드 | Full | Full 배정 지점 | Own 담당 수업 | None | None |
| 회원 목록 조회 | Full | Full 배정 지점 | Own 담당 회원 제한정보 | Own 본인 | Own 자녀 |
| 회원 등록/수정 | Full | Edit 배정 지점 | None | Own 기본정보 일부 | Own 자녀 기본정보 일부 |
| 회원 휴회/퇴회 처리 | Full | Edit 배정 지점 | None | 요청만 | 요청만 |
| 학부모 연결 관리 | Full | Edit 배정 지점 | None | None | Own 자녀 연결 확인 |
| 코치/직원 관리 | Full | Edit 배정 지점 | None | None | None |
| 수업/반 관리 | Full | Edit 배정 지점 | Own 담당 수업 View | View 등록 수업 | View 자녀 수업 |
| 수업 정원/코치 배정 | Full | Edit 배정 지점 | View | None | None |
| 출석 등록 | Full | Edit 배정 지점 | Own 담당 수업 | None | None |
| 출석 수정/삭제 | Full | Edit 사유 필수 | Own 당일 사유 필수 | None | None |
| 수업/회원 메모 | Full | Edit 배정 지점 | Own 담당 수업 | None | None |
| 출석 이력 조회 | Full | Full 배정 지점 | Own 담당 회원 | Own 본인 | Own 자녀 |
| 결제 상태 조회 | Full | Full 배정 지점 | 활성/만료 여부만 | Own 본인 | Own 자녀 |
| 결제 등록/수정 | Full | Edit 배정 지점 | None | None | None |
| 환불/할인 처리 | Full | Edit 배정 지점 | None | None | None |
| 미납/만료 필터 | Full | Full 배정 지점 | None | Own 본인 상태 | Own 자녀 상태 |
| 요청 기능 | None | None | None | None | None |
| 공지 작성/발송 | Full | Edit 배정 지점 | Own 담당 반 | None | None |
| 공지 조회/읽음 | Full | Full 배정 지점 | Own 대상 | Own 대상 | Own 대상 |
| CSV 내보내기 | Full | Full 배정 지점 | None | None | None |
| 기준 데이터/정책 설정 | Full | View | None | None | None |
| 권한 관리 | Full | Edit 배정 지점 직원 | None | None | None |
| 감사 로그 | Full | View 배정 지점 | None | None | None |

정책:

- 모든 핵심 데이터는 `branchId`로 격리한다.
- 대표의 `Full`/`Edit` 범위는 배정된 지점으로 제한한다.
- 코치의 `Own` 범위는 담당 수업, 담당 반, 배정된 회원의 제한 정보로 제한한다.
- 회원은 본인 정보, 학부모는 연결된 자녀 정보만 조회하거나 요청할 수 있다.
- 코치는 결제 금액을 보지 않고 회원권 활성/만료 여부만 확인한다.
- 권한 변경, 환불, 출석 과거 수정, 회원 휴회/퇴회는 감사 로그에 `actor`, `target`, `before`, `after`, `reason`, `timestamp`를 남긴다.

## 18. Attendance State Button Component

### 18.1 Purpose

`AttendanceStateButton`은 수업 출석 명단에서 회원별 상태를 빠르게 바꾸는 컴포넌트다. 태블릿 터치와 키보드 조작을 모두 지원한다.

### 18.2 Status Contract

```ts
type AttendanceStatus =
  | "pending"
  | "present"
  | "late"
  | "absent"
  | "excused"
  | "trial";
```

| Status | Label | Icon | Primary action |
| --- | --- | --- | --- |
| `pending` | 미체크 | `CircleDashed` | 아직 처리하지 않음 |
| `present` | 출석 | `Check` | 정상 출석 처리 |
| `late` | 지각 | `Clock3` | 지각 처리, 시간 기록 |
| `absent` | 결석 | `X` | 결석 처리 |
| `excused` | 사유 | `FileCheck2` | 사유결석, 메모 권장 |
| `trial` | 체험 | `Sparkles` | 체험 수업 참여 |

### 18.3 Component Anatomy

```text
[ icon ] [ label ] [ optional note dot ]
```

Props draft:

```ts
interface AttendanceStateButtonProps {
  status: AttendanceStatus;
  selected?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  hasNote?: boolean;
  memberName: string;
  onChange: (nextStatus: AttendanceStatus) => void;
  onOpenNote?: () => void;
}
```

### 18.4 Sizes

| Size | Height | Min Width | Padding | Use |
| --- | ---: | ---: | --- | --- |
| `sm` | `32px` | `72px` | `0 10px` | dense table |
| `md` | `36px` | `84px` | `0 12px` | default roster |
| `lg` | `44px` | `96px` | `0 14px` | tablet touch mode |

### 18.5 Visual States

| UI State | Rule |
| --- | --- |
| Default | 상태별 연한 배경, 상태별 border/text |
| Hover | border를 한 단계 진하게, 배경 약간 강조 |
| Selected | 상태별 진한 배경, 흰색 텍스트, icon 흰색 |
| Focus | `shadow.focus`, outline offset `2px` |
| Disabled | neutral bg/text, icon muted, cursor default |
| Loading | 버튼 폭 유지, spinner + 기존 label |

Selected colors:

| Status | Selected BG |
| --- | --- |
| `present` | `#2EA66F` |
| `late` | `#D99A00` |
| `absent` | `#D64545` |
| `excused` | `#4D6FEA` |
| `trial` | `#16A39A` |

### 18.6 Interaction

- 단일 버튼 모드: 버튼 클릭 시 status picker popover를 열고 상태를 선택한다.
- 빠른 토글 모드: 현재 상태가 `pending`이면 첫 클릭은 `present`로 처리한다.
- 버튼 그룹 모드: 회원 행에 여러 상태 버튼을 나열하고 하나만 selected가 된다.
- `late` 선택 시 현재 시각을 자동 기록하고, 수정 가능하게 한다.
- `excused`는 메모 입력을 권장한다.
- 권한이 없으면 disabled 처리하고 tooltip에 `출석 수정 권한이 없습니다`를 표시한다.

Keyboard:

- `Tab`: 다음 회원 또는 다음 버튼으로 이동
- `Enter`/`Space`: 선택 또는 picker 열기
- `ArrowLeft`/`ArrowRight`: 버튼 그룹 안 상태 이동
- `Esc`: picker 닫기

Accessibility:

- `aria-pressed`로 선택 상태를 제공한다.
- 라벨은 `"{회원명} 출석 상태: {상태}"` 형식으로 제공한다.
- 색상만으로 상태를 전달하지 않는다.

### 18.7 Usage Example

```tsx
<AttendanceStateButton
  memberName="김민준"
  status="present"
  selected
  size="md"
  hasNote={false}
  onChange={setStatus}
/>
```

## 19. Initial Component Inventory

1차 구현 우선순위:

1. `Button`
2. `Input`, `Select`, `Textarea`
3. `Badge`
4. `AttendanceStateButton`
5. `Table`
6. `Tabs`
7. `Card`
8. `Modal`
9. `Toast`
10. `PermissionGate`

`PermissionGate` 예시:

```tsx
<PermissionGate permission="attendance:update" scope="own">
  <AttendanceStateButton ... />
</PermissionGate>
```

## 20. Accessibility Baseline

- 모든 interactive element는 keyboard focus가 보여야 한다.
- 색 대비는 WCAG AA 이상을 목표로 한다.
- 폼 오류는 field 아래 텍스트와 `aria-describedby`로 연결한다.
- 모달은 focus trap과 `aria-modal="true"`를 적용한다.
- 토스트는 결과 성격에 따라 `role="status"` 또는 `role="alert"`를 쓴다.
- 출석 처리처럼 빠른 반복 액션은 undo toast 또는 변경 로그를 제공한다.

## 21. Implementation Notes

- 아이콘은 `lucide-react` 기준으로 정의한다.
- CSS 변수는 `:root`에 foundation token, component scope에 component token을 둔다.
- 상태색은 component 내부 hardcode 대신 `component.attendance.*` 토큰을 참조한다.
- 테이블과 출석 화면은 desktop dense mode와 tablet touch mode를 둘 다 지원한다.
- 추후 실제 브랜드 로고, 도장 사진, 띠 색 규칙이 정해지면 color palette와 badge rules를 보정한다.
