# Bob Handover Template

Use this template when a Paperclip dispatcher/collector agent needs to hand implementation work to IBM Bob.

## Required handover body

```text
Task goal:
<What Bob should accomplish.>

Scope:
<Exact files/directories Bob is allowed to edit. Prefer absolute paths.>

Acceptance criteria:
<Exact success condition.>

Verification steps:
<How Bob must verify the result after editing.>

Final report format:
<What Bob should report back.>
```

## Rules

- Keep the scope narrow.
- Use absolute paths when Paperclip may invoke the dispatcher outside the repository root.
- Make acceptance criteria testable.
- Include verification steps that require checking the filesystem after edits.
- Ask Bob to report changed files and verification status.
- Do not allow broad or unrestricted edits unless the task deliberately requires it.

## Dispatcher command

```bash
/home/andreldsg/The-Forge/paperclip-openrouter/scripts/paperclip-bob-dispatch.sh <ABSOLUTE_HANDOVER_PATH>
```
