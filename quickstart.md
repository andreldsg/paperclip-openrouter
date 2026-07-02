# Paperclip OpenRouter Quickstart

This guide is for reinstalling or setting up the modified Paperclip OpenRouter fork on a fresh machine.

Repository:

```text
https://github.com/andreldsg/paperclip-openrouter
```

Main adapter path:

```text
packages/adapters/openrouter
```

---

## 1. Clone

If the OpenRouter work was pushed to `main`:

```bash
git clone https://github.com/andreldsg/paperclip-openrouter.git
cd paperclip-openrouter
```

If the OpenRouter work lives on a branch:

```bash
git clone -b local/openrouter-adapter https://github.com/andreldsg/paperclip-openrouter.git
cd paperclip-openrouter
```

---

## 2. Install dependencies

```bash
pnpm install
```

The OpenRouter nested CLI is wired into the pnpm workspace through:

```yaml
packages/adapters/*/cli
```

So you should not need to run `npm install` manually inside:

```text
packages/adapters/openrouter/cli
```

---

## 3. Configure OpenRouter API key

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

Recommended default:

```text
openrouter/auto
```

Explicit model example:

```text
nvidia/nemotron-nano-9b-v2:free
```

Use exact OpenRouter model IDs, not display names.

---

## 4. Build

From the repository root:

```bash
pnpm --filter @paperclipai/adapter-openrouter build
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build
pnpm --filter paperclipai build
```

The OpenRouter adapter build also builds the nested OpenRouter CLI:

```bash
tsc && pnpm --dir cli build
```

---

## 5. Test OpenRouter CLI directly

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

Some models may emit leading/trailing newlines. That is usually harmless.

---

## 6. Test an explicit model

```bash
source .env.openrouter

printf 'Reply with: model test passed.' | node packages/adapters/openrouter/cli/dist/index.js \
  --print \
  --output-format stream-json \
  --model 'nvidia/nemotron-nano-9b-v2:free' \
  --max-tokens 128

echo "EXIT:$?"
```

Expected result:

```text
{"type":"assistant","content":"model test passed."}
{"type":"done"}
EXIT:0
```

If the CLI exits `0` but only emits `{"type":"done"}`, the model likely returned no usable assistant output. Inside Paperclip, the server adapter should now fail that run clearly instead of silently succeeding.

---

## 7. List currently available free OpenRouter models

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

Pick one exact model ID from the output and test it with the direct CLI command before assigning it to a Paperclip agent.

---

## 8. Test inside Paperclip

Create a Paperclip task:

```text
Title:
Explicit OpenRouter Model Test

Description:
Reply with exactly:

Explicit OpenRouter model test passed.

Do not add anything else.
```

Assign it to the OpenRouter agent.

Expected behavior:

```text
Task assigned
OpenRouter adapter runs
OpenRouter replies
Paperclip posts the comment
Task is marked done
```

---

## 9. Debug logging

Debug logging is disabled by default.

To enable OpenRouter adapter debug logging, start Paperclip with:

```bash
OPENROUTER_ADAPTER_DEBUG=1 pnpm dev
```

Debug log path:

```text
/tmp/paperclip-openrouter-debug.log
```

Remove old logs:

```bash
rm -f /tmp/paperclip-openrouter-debug.log
```

---

## 10. Known model behavior

`openrouter/auto` is usually the safest model value because OpenRouter chooses a working endpoint.

Explicit model IDs work, but the selected model must be valid and currently routable.

Examples observed during testing:

```text
google/gemini-2.0-flash-exp:free
→ stale/unavailable endpoint at the time of testing

cognitivecomputations/dolphin-mistral-24b-venice-edition:free
→ upstream rate-limited at the time of testing

nvidia/nemotron-nano-9b-v2:free
→ worked successfully
```

---

## 11. Reinstall checklist

After cloning on a new system:

```bash
pnpm install
pnpm --filter @paperclipai/adapter-openrouter build
pnpm --filter @paperclipai/server build
pnpm --filter @paperclipai/ui build
pnpm --filter paperclipai build
```

Then recreate:

```text
.env.openrouter
```

Then configure the OpenRouter agent in Paperclip.

---

## 12. Commit and push future changes

```bash
git status --short
git add .
git diff --cached --check
git commit -m "Update OpenRouter adapter setup"
git push
```

If GitHub rejects a push because of workflow files, your token needs workflow permission.

For a fine-grained token, grant:

```text
Repository permissions:
Contents: Read and write
Workflows: Read and write
Metadata: Read-only
```

For a classic token, grant:

```text
repo
workflow
```
