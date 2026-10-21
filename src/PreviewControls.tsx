/** Development fixtures are chosen at the bridge boundary, never in production UI. */
export function PreviewControls() {
  const scenarios = [
    ['1', '示例'], ['stress', '边界'], ['empty', '空'], ['one', '单项'], ['many', '千项'], ['missing', '未安装'], ['partial', '部分']
  ];
  const selected = new URLSearchParams(location.search).get('preview') || '1';
  return <nav className="preview-data-switcher" aria-label="开发预览数据">
    {scenarios.map(([value, label]) => {
      const url = new URL(location.href);
      url.searchParams.set('preview', value);
      return <a key={value} href={`${url.pathname}${url.search}${url.hash}`} aria-current={selected === value ? 'true' : undefined} title={`切换${label}数据`}>{label}</a>;
    })}
  </nav>;
}
