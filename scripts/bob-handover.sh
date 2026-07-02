#!/usr/bin/env bash
set -euo pipefail

handover_file="${1:-}"

if [[ -z "$handover_file" || ! -f "$handover_file" ]]; then
  echo "Usage: $0 <handover.md>" >&2
  exit 2
fi

bob --trust \
    --approval-mode "${BOB_APPROVAL_MODE:-auto_edit}" \
    --chat-mode "${BOB_CHAT_MODE:-code}" \
    --output-format stream-json \
    -p "$(cat "$handover_file")" \
  | python3 -c 'import sys,json

attempt_completion_ids=set()
outputs=[]

for line in sys.stdin:
    try:
        e=json.loads(line)
    except Exception:
        continue

    if e.get("type")=="tool_use" and e.get("tool_name")=="attempt_completion":
        tool_id=e.get("tool_id")
        if tool_id:
            attempt_completion_ids.add(tool_id)

    elif e.get("type")=="tool_result" and e.get("tool_id") in attempt_completion_ids:
        out=e.get("output","").strip()
        if out:
            outputs.append(out)

if not outputs:
    print("ERROR: Bob produced no final attempt_completion output.", file=sys.stderr)
    sys.exit(1)

print(outputs[-1])'
