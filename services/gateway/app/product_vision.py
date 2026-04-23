"""Product vision constants aligned with docs/product/*.md — keep in sync when editing those files."""

DEFAULT_SYSTEM_PROMPT = (
    "You are a concise, helpful personal AI assistant for mobile users. "
    "Prioritize short, actionable answers; offer a clear next step when relevant. "
    "Stay neutral and safe; refuse harmful or illegal requests."
)

ONE_LINER = (
    "바쁜 개인 사용자가 모바일에서 짧게 질문·정리·다음 행동을 잡을 수 있는 일상 AI 비서."
)

SCENARIOS: list[dict[str, str]] = [
    {
        "id": "S1",
        "summary": "하루 안건·질문을 채팅으로 빠르게 정리",
        "cadence": "매일 또는 필요 시",
        "scenario_type": "즉시 질의응답",
        "preconditions": "네트워크·게이트웨이 가용",
        "trigger": "이동 중·잠깐 쉴 때 떠오른 질문",
        "first_action": "채팅에 한 줄 입력",
        "success": "답이 짧고 실행 가능한 다음 스텝이 나온다",
    },
    {
        "id": "S2",
        "summary": "지난 대화를 찾아 이어가기",
        "cadence": "주 2회 이상",
        "scenario_type": "맥락 복원",
        "preconditions": "저장된 세션/히스토리 존재",
        "trigger": "예전에 물어본 내용 재확인",
        "first_action": "히스토리 검색 후 스레드 열기",
        "success": "맥락을 잃지 않고 이어서 질문할 수 있다",
    },
    {
        "id": "S3",
        "summary": "모델·언어·톤을 상황에 맞게 맞추기",
        "cadence": "주 1회 또는 상황 전환 시",
        "scenario_type": "환경 전환",
        "preconditions": "설정 화면 접근",
        "trigger": "회사/개인, 언어 전환",
        "first_action": "설정에서 모델·스타일 변경",
        "success": "같은 질문도 원하는 톤·언어로 받는다",
    },
]

DIFFERENTIATION: list[str] = [
    "틈새 시간·이동 중 사용을 전제로 짧은 결론과 바로 실행할 다음 한 가지를 기본 경험으로 둔다. (S1·비전 정렬)",
    "지난 대화를 찾아 이어가는 맥락 복원을 핵심 루프로 두어 스레드만 쌓이는 경험을 줄인다. (S2·히스토리)",
    "LLM은 게이트웨이 단일 경유로 키·정책·로깅을 묶고, 일일 예산·속도 제한으로 사용 리듬과 비용을 가드한다.",
]

DOC_PATHS: dict[str, str] = {
    "one_liner": "docs/product/product-vision-one-liner.md",
    "scenarios": "docs/product/recurring-scenarios.md",
    "validation": "docs/product/vision-validation-checklist.md",
    "differentiation": "docs/product/strategic-differentiation.md",
    "competitive_comparison": "docs/product/competitive-comparison.md",
}
