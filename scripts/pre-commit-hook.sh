#!/usr/bin/env bash

set -euo pipefail

# This script is run from the top of the work tree and so shouldn't use magic to find the scripts etc.
ROOT="$(pwd)"

if [[ ! -L "${ROOT}/.git/hooks/pre-commit" ]]; then
  echo "Installing git hook"
  ln -sf "$(realpath "${BASH_SOURCE[0]}")" "${ROOT}/.git/hooks/pre-commit"
fi

if [[ "${1-}" == "--install" ]]; then
  exit 0
fi

echo "Running pre-commit hooks"

# Stash only if we're not merging.
if ! git rev-parse --quiet --verify MERGE_HEAD >/dev/null; then
  STASH_NAME="pre-commit-$(date +%s)"
  old_stash=$(git rev-parse --quiet --verify refs/stash || true)
  git stash save --quiet --include-untracked --keep-index "${STASH_NAME}"
  new_stash=$(git rev-parse --quiet --verify refs/stash)

  # If the stash actually saved something, set up something to restore it no matter what.
  if [[ "$old_stash" != "$new_stash" ]]; then
    function restore() {
      RESULT=$?
      git reset --hard --quiet
      git stash apply --index --quiet
      git stash drop --quiet
      exit $RESULT
    }
    trap restore EXIT
  fi
fi

make pre-commit

echo "Pre-commit hooks: ok!"
