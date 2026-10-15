# SSP English Coach — prototype

> THROWAWAY PROTOTYPE: test whether learning from real meeting transcripts is useful enough to become a product.

Paste a meeting transcript. A local Ollama model will:

1. Find recurring, reliable English mistakes.
2. Create a short lesson from the learner's own examples.
3. Generate Vietnamese-to-English exercises.
4. Correct each answer and generate the next exercise.

Everything stays on the computer. The browser talks to a local Node server, which talks to Ollama at `http://localhost:11434`. A local browser counter records how many transcripts and exercises were completed, so the prototype can test repeat usage without accounts or a database.

## Run

Requirements:

- Node.js
- Ollama running locally
- At least one Ollama model installed

```bash
npm start
```

Then open <http://localhost:4173>.

The prototype prefers `qwen3.5:4b-q4_K_M` for a usable response time. You can select `gemma4:26b` for a slower experiment on a machine with enough memory. Models unload immediately after each response so they do not keep several GB of RAM occupied between exercises.

## Prototype question

Will the learner paste a transcript and complete at least three exercises after three out of the next five meetings?

Do not add accounts, a database, streaks, or course content until that behavior is observed.
