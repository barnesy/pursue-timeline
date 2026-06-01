# Off Nominal — local MCP server

Exposes the Off Nominal corpus (2,737 declassified-anomaly documents) and its
**honesty-layer analytics** as [Model Context Protocol](https://modelcontextprotocol.io)
tools, so any MCP client — Claude Desktop, Claude Code — can run autonomous,
multi-step investigations over the data.

It runs **locally over stdio**, reads the same static JSON the web app ships
(`public/*.json`), and reuses the *exact same pure analytics* (`src/`) — so its
findings are identical to the UI's. **Zero hosting cost, no network, read-only.**

## Why this is different from "ask an LLM about UFOs"

Every tool that reports a connection **leads with the adversarial verdict /
significance label**. The corpus's whole point is the anti-pareidolia layer:
most UAP↔nuclear-test proximities are *statistically expected* given how often
tests fired (172 of 180 are coincidental). The tools enforce that framing so an
agent can't quietly narrate a coincidence as a finding.

## Tools

| Tool | What it returns |
|---|---|
| `corpus_overview` | Dataset counts + the Monte Carlo baseline. **Call first to calibrate.** |
| `search_documents` | Ranked fuzzy/prefix search → document ids |
| `get_document` | Full record + (for UAP) its significance tier |
| `find_correlations` | A document's cross-dataset links, **each led by its verdict** |
| `test_hypothesis` | Two ids → verdict + case-for + skeptic's rebuttal (the honesty tool) |
| `nearest_in_time` | Nearest nuclear test + Monte Carlo p-value + interpretation |
| `entity_dossier` | Everywhere a person/place appears, grouped by dataset |

## Run it

```bash
npm install
npm run build-corpus-stats   # ensure public/corpus-stats.json exists
npm run mcp                  # starts the stdio server (Ctrl-C to stop)
```

## Connect from Claude Desktop / Claude Code

Add to your MCP config (Claude Desktop: `claude_desktop_config.json`; Claude
Code: `.mcp.json` or `claude mcp add`). Point it at this repo:

```json
{
  "mcpServers": {
    "off-nominal": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/Users/barnesy/Projects/pursue-timeline"
    }
  }
}
```

Then ask your agent things like:
- *"Use off-nominal: what's the corpus baseline, then find the strongest
  connection to the Sandia Base UAP case and test whether it survives scrutiny."*
- *"Build a dossier on Harold Puthoff across the datasets."*

The agent will call `corpus_overview` → `search_documents` → `find_correlations`
→ `test_hypothesis`, and — because the tools front-load the verdicts — it will
correctly report that the Sandia↔Trinity link is *Likely coincidence (0.18)*,
not a smoking gun.

## Notes

- **Distribution:** runs via `npx tsx mcp/server.ts` — no build step. (A future
  `npx off-nominal-mcp` bin could bundle the JSON for standalone install.)
- **Determinism:** no LLM in the server; every verdict is computed. Same inputs
  → same outputs.
- **Refresh:** re-run `npm run build-corpus-stats` after a data update so the
  server's analytics match the latest corpus.
