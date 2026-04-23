// FlatList 안정 참조 헬퍼. 매 렌더마다 새 함수·스타일을 만들지 않도록 모듈 레벨로 고정한다.

export const idKeyExtractor = (item: { id: number | string }) => String(item.id);

export const stringKeyExtractor = (item: { id: string }) => item.id;

// 긴 리스트에 공통으로 쓰는 FlatList 성능 옵션. 필요한 화면에서 spread해 적용한다.
export const listPerfProps = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;
