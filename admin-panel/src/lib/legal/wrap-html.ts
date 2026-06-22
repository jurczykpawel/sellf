export function wrapHtml(fragment: string, title: string): string {
  if (/^\s*<!doctype/i.test(fragment) || /^\s*<html/i.test(fragment)) return fragment;
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
  return `<!doctype html>
<html lang="pl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>body{max-width:48rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#1a1a1a}h1,h2,h3{line-height:1.25}</style>
</head><body>
${fragment}
</body></html>`;
}
