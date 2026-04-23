# 프롬프트 플래그 — 설정 예시 (도입 시)

`app/config.py`에 추가할 수 있는 필드 예시(이름은 팀에 맞게 조정).

```python
# 예시 — 실제 코드와 다를 수 있음
prompt_variant: str = "default"  # default | v2
experiment_id: str = ""  # 비어 있으면 control
```

`chat_service.generate` 초반에서 `variant = settings.prompt_variant`를 읽고 `prompt_registry.get(variant)` 패턴으로 통일한다.

## 롤백

1. 설정을 `default`로 되돌린다.  
2. 배포가 설정 주도면 **재배포 없이** env만 변경 가능한지 확인한다.
