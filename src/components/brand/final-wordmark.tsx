type FinalWordmarkProps = {
  size?: "sm" | "md";
  ariaHidden?: boolean;
  className?: string;
};

const sizeClasses = {
  sm: "h-7",
  md: "h-8",
} as const;

// 헥사곤 마크: fill-rule="evenodd" 로 내부 컷아웃을 투명하게 처리
// → 밝은 배경/어두운 배경 모두 정상 렌더링
export function FinalWordmark({ size = "md", ariaHidden = false, className = "" }: FinalWordmarkProps) {
  return (
    <svg
      className={`${sizeClasses[size]} w-auto shrink-0 ${className}`.trim()}
      viewBox="0 0 310 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={ariaHidden ? undefined : "img"}
      aria-label={ariaHidden ? undefined : "FINAL"}
      aria-hidden={ariaHidden ? true : undefined}
      data-testid="final-wordmark"
      focusable="false"
    >
      {/*
        헥사곤 마크 (pointy-top, 중심 44,44, 외반경 40)
        꼭짓점: 상(44,4) 우상(78.6,24) 우하(78.6,64) 하(44,84) 좌하(9.4,64) 좌상(9.4,24)

        evenodd: 외곽 헥사곤 + 내부 컷아웃 서브패스를 하나의 path에 기술
        → 컷아웃 영역이 투명해져 배경색에 무관하게 동작
      */}
      <image href="/brand/final-mark.png" x="4" y="4" width="80" height="80" />

      {/* FINAL 텍스트 */}
      <text
        x="96"
        y="72"
        fontFamily="'Arial Black', 'Impact', 'Arial', sans-serif"
        fontSize="68"
        fontWeight="900"
        fontStyle="italic"
        fill="currentColor"
        letterSpacing="-2"
      >
        FINAL
      </text>
    </svg>
  );
}
