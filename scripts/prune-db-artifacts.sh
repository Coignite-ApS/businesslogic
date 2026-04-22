#!/usr/bin/env bash
# =============================================================================
# Prune DB Admin Artifacts (count-based retention only — never time-based)
# =============================================================================
# Defaults (override via env):
#   KEEP_ROUTINE=10  # Real routine snapshots: snapshot_YYYYMMDD_HHMMSS[_slug].ext
#   KEEP_TASK=20     # Task slugs (pre_+post_): keep last N slugs (pair-safe)
#   KEEP_DRYRUN=2    # Dryrun/cancelled snapshots: aggressively pruned
#   KEEP_REPORTS=0   # 0 = never delete reports; >0 = keep N most recent
#   DRY_RUN=0        # 1 = print what would be deleted, do nothing
#
# Categories of files in the snapshot dirs:
#   1. REAL ROUTINE — snapshot_YYYYMMDD_HHMMSS[_<slug>].{sql.gz|yaml}
#                     (strict: must have 8 digits + _ + 6 digits after "snapshot_")
#   2. REAL TASK    — {pre,post,forensic}_<slug>_YYYYMMDD_HHMMSS.{sql.gz|yaml}
#                     (forensic_* = state captured before a Phase 6.5 rollback;
#                      grouped with the slug so investigation evidence ages out together)
#   3. DRYRUN       — dryrun_<anything>_YYYYMMDD_HHMMSS.{sql.gz|yaml}
#                     (cancelled tasks, exploratory snapshots — not real history)
#   4. IRREGULAR    — anything else matching snapshot_*.{sql.gz|yaml} or
#                     {pre,post}_*.{sql.gz|yaml} that doesn't match strict patterns.
#                     Reported but NEVER deleted automatically — user must rename
#                     or remove. Goal: snapshot dirs hold only files you'd consult
#                     during an incident.
#
# Files unrelated to these patterns (e.g., apply-schema.sh, snapshot.yaml,
# README.md, *.sql.gz from legacy formats) are LEFT ALONE.
# Nothing is ever deleted because of age. Only count thresholds trigger deletion.
# =============================================================================

set -euo pipefail

KEEP_ROUTINE="${KEEP_ROUTINE:-10}"
KEEP_TASK="${KEEP_TASK:-20}"
KEEP_DRYRUN="${KEEP_DRYRUN:-2}"
KEEP_REPORTS="${KEEP_REPORTS:-0}"
DRY_RUN="${DRY_RUN:-0}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_DIR="$REPO_ROOT/infrastructure/db-snapshots"
SCHEMA_DIR="$REPO_ROOT/services/cms/snapshots"
REPORTS_DIR="$REPO_ROOT/docs/reports"

# Strict pattern fragments for shell regex matching ([[ =~ ]])
ROUTINE_RX='^snapshot_[0-9]{8}_[0-9]{6}(_[A-Za-z0-9._-]+)?\.(sql\.gz|yaml)$'
TASK_RX='^(pre|post|forensic)_[A-Za-z0-9._-]+_[0-9]{8}_[0-9]{6}\.(sql\.gz|yaml)$'
DRYRUN_RX='^dryrun_[A-Za-z0-9._-]+_[0-9]{8}_[0-9]{6}\.(sql\.gz|yaml)$'
SUSPECT_RX='^(snapshot|pre|post|forensic|dryrun)_'   # anything that *looks* like one of ours

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

# Get mtime portably (macOS stat -f, GNU stat -c)
mtime_of() {
  local f="$1" m
  if m=$(stat -f %m "$f" 2>/dev/null); then echo "$m"; else stat -c %Y "$f" 2>/dev/null || echo 0; fi
}

# List files in dir matching $bash_regex on basename, newest-first.
list_matching() {
  local dir="$1" rx="$2"
  [ -d "$dir" ] || return 0
  local f base
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [[ "$base" =~ $rx ]]; then
      printf '%s\t%s\n' "$(mtime_of "$f")" "$f"
    fi
  done | sort -rn | awk -F'\t' '{print $2}'
}

# Routine: keep newest N files matching strict ROUTINE_RX.
prune_routine() {
  local dir="$1"
  list_matching "$dir" "$ROUTINE_RX" | tail -n +$((KEEP_ROUTINE + 1)) | while read -r f; do
    [ -n "$f" ] || continue
    echo "delete (routine, keep $KEEP_ROUTINE): $f"
    run "rm -f \"$f\""
  done
}

# Dryrun: keep newest N files matching DRYRUN_RX. Aggressive cleanup.
prune_dryrun() {
  local dir="$1"
  list_matching "$dir" "$DRYRUN_RX" | tail -n +$((KEEP_DRYRUN + 1)) | while read -r f; do
    [ -n "$f" ] || continue
    echo "delete (dryrun, keep $KEEP_DRYRUN): $f"
    run "rm -f \"$f\""
  done
}

# Task: group {pre,post}_<slug>_<ts>.<ext> by slug; keep newest KEEP_TASK slugs.
# All files of dropped slugs deleted together (preserves pre+post pairing).
prune_task() {
  local dir="$1"
  [ -d "$dir" ] || return 0

  local listing slug base name mtime
  listing=$(list_matching "$dir" "$TASK_RX" | while read -r f; do
    base=$(basename "$f")
    name="${base%.sql.gz}"; name="${name%.yaml}"
    name="${name#pre_}"; name="${name#post_}"; name="${name#forensic_}"
    slug=$(echo "$name" | sed -E 's/_[0-9]{8}_[0-9]{6}$//')
    mtime=$(mtime_of "$f")
    printf '%s\t%s\t%s\n' "$slug" "$mtime" "$f"
  done)

  [ -z "$listing" ] && return 0

  local victim_slugs
  victim_slugs=$(echo "$listing" | awk -F'\t' '
    { if ($2 > latest[$1]) latest[$1] = $2 }
    END { for (s in latest) print latest[s] "\t" s }
  ' | sort -rn | tail -n +$((KEEP_TASK + 1)) | awk -F'\t' '{print $2}')

  [ -z "$victim_slugs" ] && return 0

  echo "$victim_slugs" | while read -r vslug; do
    [ -n "$vslug" ] || continue
    echo "$listing" | awk -F'\t' -v s="$vslug" '$1 == s { print $3 }' | while read -r f; do
      echo "delete (task slug '$vslug' beyond keep=$KEEP_TASK): $f"
      run "rm -f \"$f\""
    done
  done
}

# Irregular: files that LOOK like ours (start with snapshot_/pre_/post_/dryrun_)
# but DON'T match any strict pattern. Report only — never delete.
report_irregular() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  local f base count=0
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    [[ "$base" == "snapshot.yaml" ]] && continue   # canonical, always preserved
    if [[ "$base" =~ $SUSPECT_RX ]]; then
      if [[ ! "$base" =~ $ROUTINE_RX ]] && [[ ! "$base" =~ $TASK_RX ]] && [[ ! "$base" =~ $DRYRUN_RX ]]; then
        echo "  ⚠ irregular (rename or delete manually): $f"
        count=$((count + 1))
      fi
    fi
  done
  if [ "$count" = "0" ]; then
    echo "  (no irregular files)"
  fi
}

prune_reports() {
  [ -d "$REPORTS_DIR" ] || return 0
  if [ "$KEEP_REPORTS" -le 0 ]; then
    echo "  reports: KEEP_REPORTS=0 (never deleted)"
    return 0
  fi
  # shellcheck disable=SC2012
  ls -t "$REPORTS_DIR"/db-admin-*.md 2>/dev/null \
    | grep -v '/db-admin-WIP-' \
    | tail -n +$((KEEP_REPORTS + 1)) \
    | while read -r f; do
        [ -n "$f" ] || continue
        echo "delete (report, keep $KEEP_REPORTS): $f"
        run "rm -f \"$f\""
      done
}

echo "=== prune-db-artifacts (count-based only) ==="
echo "  KEEP_ROUTINE=$KEEP_ROUTINE  KEEP_TASK=$KEEP_TASK  KEEP_DRYRUN=$KEEP_DRYRUN  KEEP_REPORTS=$KEEP_REPORTS  DRY_RUN=$DRY_RUN"
echo ""

echo "[PG dumps] routine rotation"
prune_routine "$PG_DIR"
echo "[PG dumps] task rotation (by slug)"
prune_task "$PG_DIR"
echo "[PG dumps] dryrun rotation"
prune_dryrun "$PG_DIR"
echo "[PG dumps] irregular file report"
report_irregular "$PG_DIR"

echo "[Schema snapshots] routine rotation"
prune_routine "$SCHEMA_DIR"
echo "[Schema snapshots] task rotation (by slug)"
prune_task "$SCHEMA_DIR"
echo "[Schema snapshots] dryrun rotation"
prune_dryrun "$SCHEMA_DIR"
echo "[Schema snapshots] irregular file report"
report_irregular "$SCHEMA_DIR"

echo "[Reports] count-based rotation (default: never)"
prune_reports

echo ""
echo "✓ prune complete"
