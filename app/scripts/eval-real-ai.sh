#!/bin/sh
# Runs the agents against the real Gemini API: two sets of about 45 typed
# sentences, 16 plan checks and a week around a busy calendar, 3 daily memory
# updates and 6 days of memory in a row, 4 memory questions and 3 safety cases. It spends from a Gemini key, looked up in
# this order and never printed, written or stored by this script:
#   1. GEMINI_API_KEY in the environment
#   2. the file named by EVERGREEN_SECRETS
#   3. ~/.config/secrets/keys.env
# The file holds NAME=value lines and must be readable by its owner only (chmod 600).
#
#   [EVAL_SECTION=ask|seen|heldout|plan|busy|memory|days|questions|safety] [EVAL_RUNS=3] scripts/eval-real-ai.sh "<simulator id>"
#
# "seen" sentences overlap the prompts' examples; "heldout" share none of them, on another weekday.
#
# One line per case (PASS or FAIL and why), then one SUMMARY line per section.
# Exits 1 when a section has no SUMMARY line or the tests failed.
set -eu

# The value of NAME from a NAME=value file, read line by line: the file is never sourced.
read_key() {
  file="$1"; name="$2"
  [ -f "$file" ] || return 1
  mode=$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")
  case "$mode" in
    *00) ;;
    *) echo "$file can be read by others (mode $mode). Run: chmod 600 \"$file\"" >&2; exit 2 ;;
  esac
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/^export[[:space:]]*//')
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    found=$(printf '%s' "${line%%=*}" | sed -e 's/[[:space:]]*$//')
    [ "$found" = "$name" ] || continue
    value=${line#*=}
    value=$(printf '%s' "$value" | sed -e 's/[[:space:]]#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//")
    printf '%s' "$value"
    return 0
  done < "$file"
  return 1
}

key="${GEMINI_API_KEY:-}"
if [ -z "$key" ]; then
  key=$(read_key "${EVERGREEN_SECRETS:-$HOME/.config/secrets/keys.env}" GEMINI_API_KEY || true)
fi
if [ -z "$key" ]; then
  echo "No GEMINI_API_KEY in the environment, in \$EVERGREEN_SECRETS or in ~/.config/secrets/keys.env." >&2
  exit 2
fi
if [ $# -lt 1 ]; then
  echo "Give the simulator's id." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
# The test process gets the key through its environment; nothing else does.
export TEST_RUNNER_GEMINI_API_KEY="$key"
export TEST_RUNNER_EVAL_SECTION="${EVAL_SECTION:-}"
export TEST_RUNNER_EVAL_RUNS="${EVAL_RUNS:-}"
unset key

out=$(mktemp)
trap 'rm -f "$out"' EXIT
xcodebuild test -project Evergreen.xcodeproj -scheme Evergreen \
  -destination "platform=iOS Simulator,id=$1" CODE_SIGNING_ALLOWED=NO \
  '-only-testing:EvergreenTests/RealAIEval/realModel()' > "$out" 2>&1 || true

grep -E '^EVAL ' "$out" | grep -v -E ' (SUMMARY|SPREAD) ' || true
grep -E '^EVAL .* (SUMMARY|SPREAD) ' "$out" || true

status=0
case "${EVAL_SECTION:-}" in
  "") wanted="ask-seen ask-heldout plan plan-busy memory memory-days memory-questions safety" ;;
  ask) wanted="ask-seen ask-heldout" ;;
  seen) wanted="ask-seen" ;;
  heldout) wanted="ask-heldout" ;;
  plan) wanted="plan plan-busy" ;;
  busy) wanted="plan-busy" ;;
  memory) wanted="memory memory-days memory-questions" ;;
  days) wanted="memory-days" ;;
  questions) wanted="memory-questions" ;;
  *) wanted="$EVAL_SECTION" ;;
esac
for section in $wanted; do
  if ! grep -q "^EVAL $section SUMMARY " "$out"; then
    echo "No summary for $section: that section did not run to the end." >&2
    status=1
  fi
done
grep -q 'TEST SUCCEEDED' "$out" || { echo "The tests failed (a section missed its target, or the run broke)." >&2; status=1; }
exit $status
