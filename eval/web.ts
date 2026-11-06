import type { DefectFixture } from './fixtures';

const escapeHTML = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function fixtureHTML(
  fixture: DefectFixture,
  includeScript = true,
): string {
  const body =
    fixture.html ??
    '<button id="run">Run</button><output id="state">Idle</output>';
  const script = includeScript
    ? `<script>${fixture.script}\n//# sourceURL=http://bugcapsule-fixture.test/${fixture.id}.js</script>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${fixture.id} — ReproQuill defect fixture</title><style>body{background:#14151c;color:#e8e8f1;font:16px system-ui;max-width:800px;margin:60px auto;padding:24px}button{padding:12px 24px;background:#7772ef;color:white;border:0;border-radius:8px;cursor:pointer}output{display:block;margin-top:24px;padding:20px;border:1px solid #444;border-radius:8px}p,li{line-height:1.7;color:#bbb}a{color:#aaa5ff}</style></head><body><a href="/">All fixtures</a><h1>${escapeHTML(fixture.id)} · ${escapeHTML(fixture.symptom)}</h1><p>Intentionally defective synthetic software. No external service is called.</p><ol>${fixture.reproductionSteps.map((step) => `<li>${escapeHTML(step)}</li>`).join('')}</ol>${body}<p>Expected behavior: ${escapeHTML(fixture.expectedBehavior)}</p>${script}</body></html>`;
}

export function fixtureIndex(fixtures: DefectFixture[]): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ReproQuill reproducible defects</title></head><body style="font:16px system-ui;max-width:900px;margin:40px auto"><h1>25 reproducible defect fixtures</h1><p>These pages are intentionally broken. Use ReproQuill's toolbar to start capture before triggering an action.</p><ul>${fixtures.map((fixture) => `<li><a href="/${fixture.id}">${fixture.id} · ${escapeHTML(fixture.symptom)}</a></li>`).join('')}</ul></body></html>`;
}
