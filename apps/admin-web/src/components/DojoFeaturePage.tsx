type DojoFeaturePageProps = {
  title: string;
  emoji: string;
  description: string;
};

export default function DojoFeaturePage({
  title,
  emoji,
  description,
}: DojoFeaturePageProps) {
  return (
    <section className="panel tab-panel page" role="tabpanel">
      <div className="page-head">
        <h2>
          {emoji} {title}
        </h2>
      </div>
      <p className="one-liner">{description}</p>
      <div className="hint" role="note">
        모바일 앱 기능을 웹 화면으로 분리 이관 중입니다. 현재 계정/회원 데이터는 즉시
        조회 가능하고, 나머지 탭은 같은 디자인 톤으로 순차 확장됩니다.
      </div>
    </section>
  );
}
