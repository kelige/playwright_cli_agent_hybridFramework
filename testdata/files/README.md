# Test data assets

Binary fixtures referenced by `testdata/dvs_paper_config.json` belong here.
They are intentionally not committed as fake files.

Required:

- `question-paper.pdf` — uploaded through **Add PDF → Upload PDF** on the paper card.
- `evaluation-scheme.pdf` — uploaded through **Marking schemes → New scheme version**.

Scanner capture fixtures (Digitization) are separate and must be supplied before
running capture tests:

- `page-1.jpeg` — first remaining page (after the cut cover).
- `page-2.jpeg` — remaining script page, filename order matters.

Rules:

- Use synthetic content only; no real candidate scripts.
- Keep page count equal to the paper's `pagesPerScript`.
- Do not upload the cut cover.
