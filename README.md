# Divide and Calibrate

A lightweight Flask UI for **staged prompt engineering**: chain prompt steps
where each box's output feeds the next, split an output into sub-steps, and
merge results back. The pipeline is defined in `config/phases.json`, so you can
reshape it without touching code. Prompts run against [duck.ai](https://duck.ai)
via Playwright.

## Run

```bash
pip install -r requirements.txt
playwright install chromium
python app.py              # open http://localhost:5000
```

Use another pipeline: `python app.py --phases path/to/phases.json`

## Pipeline

`config/phases.json` holds `settings` (delay, max words, breakdown depth) and
`phases` of `steps`. Each step has a `prompt_template` and a `type`:

- `normal` — transform input, pass output on
- `context` — output fills the `{context}` placeholder for later prompts
- `splittable` — adds a **Split** button to break output into sub-steps

`{init}` is the first box's input. In the UI: **Run** a box, **Split** an
output into children, **Merge** siblings into a new panel.

`duckai.py` also works standalone: `python duckai.py "your question"`

Research tool — use responsibly and within duck.ai's terms.
