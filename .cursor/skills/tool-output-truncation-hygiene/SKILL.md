---
name: tool-output-truncation-hygiene
description: >-
  Truncate terminal/log output in replies; point to file path for huge blobs.
  Use after long pytest, build logs, or ripgrep floods. Korean: 로그 잘라내기.
---

# 도구 출력 요약

## 지침

1. 터미널·테스트 출력은 **요약 + 마지막 30줄** 또는 에러 블록만.  
2. 전체 로그가 필요하면 **파일 경로**만 남긴다.  
3. 같은 명령 **반복 실행**은 인용하지 않고 “동일”으로 표시한다.
