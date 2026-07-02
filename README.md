# Paperclip OpenRouter Edition

This repository is a personal modified build of Paperclip with a working OpenRouter adapter integrated into the app.

It allows Paperclip agents to use OpenRouter models through a single OpenRouter API key, including:

- `openrouter/auto`
- explicit OpenRouter model IDs
- free OpenRouter models when available
- paid OpenRouter models when configured

This is not an official upstream Paperclip release. It is a working personal fork / reference implementation for OpenRouter support.

The original upstream README can be preserved separately as:

```text
README.upstream.md
```

For reinstall/setup instructions, see:

```text
quickstart.md
```

---

## What changed in this version

This fork adds and wires in the OpenRouter adapter:

```text
packages/adapters/openrouter
```

The adapter is integrated into the Paperclip server, UI, CLI dependencies, and workspace build flow.

Key integration areas:

```text
server/src/adapters/registry.ts
ui/src/adapters/registry.ts
cli/package.json
server/package.json
ui/package.json
pnpm-workspace.yaml
pnpm-lock.yaml
```

The nested OpenRouter CLI is included in the pnpm workspace and builds as part of the adapter build.

---

## Confirmed working

The integration has been tested with:

```text
openrouter/auto
nvidia/nemotron-nano-9b-v2:free
```

Confirmed behavior:

- OpenRouter adapter appears in Paperclip.
- OpenRouter API key validation works.
- OpenRouter model listing works.
- `openrouter/auto` works.
- Explicit OpenRouter model IDs work.
- Paperclip task context reaches the model.
- Paperclip comments are posted.
- Paperclip task status updates to `done`.
- Run details page opens correctly.
- Invalid, unavailable, rate-limited, or empty-output model responses fail clearly instead of silently succeeding.

---

## Quick install

```bash
git clone https://github.com/andreldsg/paperclip-openrouter.git
cd paperclip-openrouter
pnpm install
pnpm --filter @paperclipai/adapter-openrouter build
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build
pnpm --filter paperclipai build
```

If the OpenRouter work is on a branch instead of `main`, clone that branch:

```bash
git clone -b local/openrouter-adapter https://github.com/andreldsg/paperclip-openrouter.git
cd paperclip-openrouter
```

---

## OpenRouter API key

Create a local env file for direct CLI/model testing:

```bash
cat > .env.openrouter <<'EOF'
OPENROUTER_API_KEY=sk-or-v1-your-key-here
EOF
```

Do not commit `.env.openrouter`.

Inside Paperclip itself, configure the OpenRouter agent with:

```text
Adapter: openrouter
API key: your OpenRouter API key
Model: openrouter/auto
```

Recommended default model:

```text
openrouter/auto
```

Explicit model example:

```text
nvidia/nemotron-nano-9b-v2:free
```

Use exact OpenRouter model IDs, not display names.

---

## Model testing command

From the repository root:

```bash
source .env.openrouter

printf 'Reply with: model test passed.' | node packages/adapters/openrouter/cli/dist/index.js \
  --print \
  --output-format stream-json \
  --model 'openrouter/auto' \
  --max-tokens 128

echo "EXIT:$?"
```

Expected result:

```text
{"type":"assistant","content":"model test passed."}
{"type":"done"}
EXIT:0
```

Explicit model example:

```bash
printf 'Reply with: model test passed.' | node packages/adapters/openrouter/cli/dist/index.js \
  --print \
  --output-format stream-json \
  --model 'nvidia/nemotron-nano-9b-v2:free' \
  --max-tokens 128

echo "EXIT:$?"
```

---

## Listing currently available free OpenRouter models

```bash
source .env.openrouter

tmp="$(mktemp)"

curl -sS -f https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -o "$tmp"

python3 - "$tmp" <<'PY'
import sys, json

with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)

models = data.get("data", [])
free = [
    m for m in models
    if isinstance(m.get("id"), str)
    and m["id"].endswith(":free")
]

for m in free[:100]:
    print(m["id"])
PY

rm "$tmp"
```

---

## Debugging

Debug logging is off by default.

Enable it when starting Paperclip:

```bash
OPENROUTER_ADAPTER_DEBUG=1 pnpm dev
```

Debug log path:

```text
/tmp/paperclip-openrouter-debug.log
```

Remove old debug logs:

```bash
rm -f /tmp/paperclip-openrouter-debug.log
```

---

## Known behavior

`openrouter/auto` is usually the safest model value because OpenRouter chooses a working endpoint.

Explicit model IDs work, but the model must be valid and currently routable.

If a selected model is invalid, unavailable, rate-limited, or returns no assistant output, the adapter fails the run clearly instead of silently marking the task successful.

Examples seen during testing:

```text
google/gemini-2.0-flash-exp:free
→ stale/unavailable endpoint at the time of testing

cognitivecomputations/dolphin-mistral-24b-venice-edition:free
→ upstream rate-limited at the time of testing

nvidia/nemotron-nano-9b-v2:free
→ worked successfully
```

---

## Notes for contributors / future cleanup

Potential future improvements:

- Replace the direct adapter with a more native Paperclip adapter implementation.
- Improve OpenRouter error propagation from the nested CLI.
- Add richer model metadata and filtering.
- Decide whether OpenRouter should remain a native adapter or route through OpenCode/OpenClaw/Codex adapters.
- Improve prompt construction to better match upstream Paperclip adapter conventions.
- Add automated tests for invalid model, empty model response, explicit model selection, and `openrouter/auto`.

---

## License

This fork includes upstream Paperclip code and the added OpenRouter adapter code. See the repository license files for details.
