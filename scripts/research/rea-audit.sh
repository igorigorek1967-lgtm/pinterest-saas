#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 || ! -d "$1" || "$1" != /* || "$2" != /* ]]; then
  echo 'Usage: bash scripts/research/rea-audit.sh /absolute/target-directory /absolute/new-evidence-directory' >&2
  exit 2
fi
target_dir="$1"
evidence_dir="$2"
if [[ -e "$evidence_dir" ]]; then
  echo 'Evidence directory already exists; choose a new directory to preserve previous evidence.' >&2
  exit 2
fi
mkdir -m 700 -p "$evidence_dir"
if ! ps -axo pid=,ppid=,pgid=,uid=,stat=,command= > /dev/null 2> "$evidence_dir/process-check.txt"; then
  echo 'REA process-ownership prerequisite failed. Do not disable or replace its safety check.' >&2
  exit 3
fi
npx -y rea-agents@6.7.0 --version > "$evidence_dir/rea-version.txt"
npx -y rea-agents@6.7.0 analyze-javascript-application "$target_dir" --max-heap-mb 4096 --analysis-timeout-ms 300000 --json > "$evidence_dir/analysis.json" 2> "$evidence_dir/progress.log"
echo "REA evidence: $evidence_dir/analysis.json"
