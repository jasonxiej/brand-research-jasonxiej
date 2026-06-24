---
name: "brand-research"
description: "Generates a structured 8-dimension brand visual research report (logo / palette / typography / photography / tone / positioning / target user / selling points + 6-axis tone radar) from a brand name or website URL, saves it as a self-contained HTML page, and indexes it into a local brand library with a 30-day trash bin. Invoke when the user asks to research/analyze/decompose a brand's visual identity, or wants to add a new brand to the {YOUR_BRAND} brand-research hub."
---

# Brand Research ({YOUR_BRAND})

A reproducible brand-visual-research workflow. Given a brand name or homepage URL, it produces:

- A self-contained **HTML report** (no build, no CDN) with 8 dimensions + tone radar + actionable takeaways
- A **JSON index entry** in `brands/index.json` so the report appears in the local brand library
- A **re-runnable** Node backend (port 8000) that serves the hub at `http://localhost:8000/`
- **Trash bin** (`brands/trash.json`): 30-day retention with one-click restore; regenerating an already-trashed brand auto-restores it

## When to invoke

- User types a brand name in the hub's input box and clicks 调研 / "Research"
- User asks to "analyze the visual identity of X" / "对 X 做品牌视觉调研" / "add X to the brand library"
- User wants to compare 2–4 brands in a radar-overlay page
- User wants to see what's in the trash bin (`/api/trash`)
- User wants to restore a brand from trash (`POST /api/trash/:id/restore`)

## How to use

### 1. Verify the project is installed

The skill expects the brand-research project at `./brand-research/` (relative to the agent's working directory) OR an absolute path passed via `BRAND_RESEARCH_DIR` env var. The project must contain:

- `server.mjs` (Node backend, port 8000)
- `lib/researcher.mjs` (LLM call + report builder; includes `sanitizeDeep` mojibake guard)
- `lib/report-template.mjs` (HTML report template)
- `_shared/js/echarts.min.js` (radar chart)
- `brands/index.json` (library index; regenerated automatically)
- `brands/trash.json` (trash bin; auto-purges after 30 days)

If missing, unzip `brand-research-project.zip` from the skill bundle.

### 2. Run the research

If the backend is already running (the user opened the hub in a browser), the input box posts to `/api/research`. Otherwise, call the function directly:

```js
import { runResearch } from './brand-research/lib/researcher.mjs';

await runResearch({
  input: 'Hatch',         // brand name OR homepage URL
  nameHint: 'Hatch',      // optional, for slug + display
  onLog: (e) => console.log(e.level, e.msg),
  onProgress: (p) => { /* p: 0..1 */ },
});
```

This will:
1. Fetch the brand's homepage HTML
2. Call your configured LLM (OpenAI-compatible API) to extract 8 dimensions + radar values
3. Sanitize the response (`sanitizeDeep` reverses Latin-1→UTF-8 mojibake + strips control chars)
4. Render `lib/report-template.mjs` with the LLM output
5. Write `<slug>-<YYYYMMDD>.html` to the project root
6. Update `brands/index.json`

### 3. Update the library

After every research, run:

```bash
node brand-research/scripts/refresh-index.cjs
```

This is idempotent and re-scans all reports. It also reconciles with the trash bin: if a trashed brand's HTML file still exists on disk, it's automatically restored to the library. It runs automatically on server startup too.

### 4. Trash bin

- `GET  /api/trash` — list trashed brands with `daysLeft`
- `POST /api/trash/:id/restore` — restore one brand to library
- `POST /api/trash/:id/purge` — permanently delete (also unlinks the HTML)
- `POST /api/trash/purge-expired` — purge everything past `retainDays` (default 30)

### 5. Compare brands

Open `http://localhost:8000/compare.html?ids=id1,id2,id3,id4` (up to 4 ids) to see a side-by-side 8-dimension table + overlapping radar + visual-north-star suggestions.

### 6. LAN access

The hub includes a fixed-position LAN card (bottom-right) that calls `/api/network-info` to display both `localhost` and LAN URLs. Pin a specific IP via env var:

```bash
# Windows
set LAN_HOST=192.168.1.100 && start-server.bat

# macOS / Linux
LAN_HOST=192.168.1.100 ./start-server.sh
```

## Output schema (per brand)

```ts
{
  id: 'hatch-20260622',          // <slug>-<YYYYMMDD>
  name: 'Hatch',
  nameZh: 'Hatch 品牌视觉研究',
  url: 'https://www.hatch.co',
  tagline: 'Sleep made beautiful.',
  category: 'Sleep Tech / Family Wellness',
  country: 'United States',
  summary: '... 一段话理解 ...',
  primaryColors: ['#F6E1C6', '#8FB9A8', '#2E2E2E', '#F8F4EC'],
  palette: [{ hex, name }, ...],
  logo: { note: '...', candidates: [...] },
  typography: { note: '...' },
  photography: { type, description },
  tone: ['温柔庇护', '克制冷暖', ...],
  toneSummary: '... 一句话调性总结 ...',
  positioning: '...',
  targetUser: { age, identity, pain, scene },
  sellingPoints: ['...', '...'],
  radar: { 克制: 4.5, 温度感: 9.0, 游戏化: 2.0, 科技感: 5.0, 情感连接: 8.5, 识别强度: 7.0 },
  radarValues: [4.5, 9.0, 2.0, 5.0, 8.5, 7.0],
  meta: { favicon, ogImage, heroImage, logoCandidates },
  reportFile: 'hatch-20260622.html',
  reportUrl: './hatch-20260622.html',
  createdAt: '2026-06-22',
}
```

The data block is embedded in the report HTML as `<script id="__BRAND_DATA__" type="application/json">…</script>` so any consumer (compare page, future tooling) can read it without re-parsing.

## Environment

- `OPENAI_BASE_URL` (default `https://your-llm-provider.example.com/v1`)
- `OPENAI_API_KEY` (required; alias `MINIMAX_API_KEY` also accepted)
- `OPENAI_MODEL` (default `your-default-model`)
- `BRAND_RESEARCH_DIR` (optional, default `./brand-research`)
- `LAN_HOST` (optional, pin a specific LAN IP for the start URL)
- `HOST` / `PORT` (optional, default `0.0.0.0` / `8000`)

## Conventions

- Filename: `<slug>-<YYYYMMDD>.html` — slug lowercase + hyphens, date is the day the report was created
- 6 radar dimensions are fixed: 克制 / 温度感 / 游戏化 / 科技感 / 情感连接 / 识别强度
- All Chinese strings pass `sanitizeDeep` in `lib/researcher.mjs` (mojibake + control-char guard)

## Notes

- The skill ships the full project as `brand-research-project.zip` (no network fetch needed)
- ECharts is vendored at `_shared/js/echarts.min.js` (no CDN)
- Fonts (InstrumentSerif / InstrumentSans / GeistMono) are vendored at `_shared/fonts/`
- `server.mjs` exposes `/api/network-info`, `/api/trash*`, `/api/research`, `/api/research/:id/events` (SSE), `/api/refresh-index`