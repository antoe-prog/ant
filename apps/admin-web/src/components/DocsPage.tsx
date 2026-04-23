type DocsPageProps = {
  docPaths: Record<string, string> | null;
};

export default function DocsPage({ docPaths }: DocsPageProps) {
  return (
    <section className="panel tab-panel" role="tabpanel">
      <h2>문서 경로</h2>
      <ul className="doc-list">
        {docPaths
          ? Object.entries(docPaths).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <code>{v}</code>
              </li>
            ))
          : null}
      </ul>
      {!docPaths ? <p className="meta">표시할 데이터가 없습니다.</p> : null}
    </section>
  );
}
