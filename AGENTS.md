# Converge — AI Agent Instructions

## Project
Converge is an AI-powered financial planning application for couples,
built for the UBS AI Financial Twin challenge at LauzHack 2026.

Read `.agents/PROJECT.md` for project context.

## Principles
- Build a functional, polished MVP.
- Prioritise correctness, simplicity, and user experience.
- Use deterministic financial calculations; never let an LLM invent numerical results.
- Keep individual and shared finances separate.
- Document financial assumptions and data sources.
- Ensure recommendations are verified by the simulation engine.
- Make changes modular, tested, and easy to integrate.

## Collaboration
- Work on the current Git branch.
- Do not modify unrelated components unnecessarily.
- Coordinate shared interfaces before changing them.
- Do not merge branches unless explicitly requested.
- Never commit secrets or local datasets.
- Run relevant tests before committing.

## Efficient Development

- Prioritise working functionality, financial correctness, and polished UX.
- Read only files relevant to the current task. Do not repeatedly inspect
  the entire repository or UBS datasets when their schemas are documented.
- Reuse existing architecture and verified components.
- For small changes, run only directly relevant tests and checks.
- Run the full test suite, frontend build, and end-to-end verification
  before major integration milestones or final delivery.
- Do not repeatedly rerun checks that already passed unless relevant
  code or configuration has changed.
- Keep command output concise; report failures and essential diagnostics.
- Avoid unnecessary subagents, lengthy planning, broad research,
  and speculative refactoring.
- Prefer deterministic scripts over LLM reasoning for repetitive work.
- Never sacrifice financial correctness to save tokens.
- Preserve the established demo workflow and avoid unrelated features.
