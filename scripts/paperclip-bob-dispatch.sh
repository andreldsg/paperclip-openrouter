#!/usr/bin/env bash
set -euo pipefail

handover_file="${1:-}"
log_file="${PAPERCLIP_BOB_DISPATCH_LOG:-${OPENCLAW_BOB_DISPATCH_LOG:-/tmp/paperclip-bob-dispatch.log}}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
bob_runner="$repo_root/scripts/bob-handover.sh"

if [[ -z "$handover_file" || ! -f "$handover_file" ]]; then
  echo "Usage: $0 <handover.md>" >&2
  exit 2
fi

if [[ ! -x "$bob_runner" ]]; then
  echo "Bob runner missing or not executable: $bob_runner" >&2
  exit 3
fi

{
  echo "PAPERCLIP_BOB_DISPATCH_STARTED"
  date -Is
  echo "cwd_before=$(pwd)"
  echo "user=$(whoami)"
  echo "repo_root=$repo_root"
  echo "handover_file=$handover_file"
  echo "bob=$(command -v bob || true)"
  echo "bob_runner=$bob_runner"
} >> "$log_file"

cd "$repo_root"

set +e
"$bob_runner" "$handover_file"
status=$?
set -e

{
  echo "PAPERCLIP_BOB_DISPATCH_EXIT_STATUS=$status"
  date -Is
  echo "PAPERCLIP_BOB_DISPATCH_FINISHED"
} >> "$log_file"

exit "$status"
