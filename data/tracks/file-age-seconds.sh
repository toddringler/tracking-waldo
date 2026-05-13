#!/usr/bin/env sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <file-path>" >&2
  exit 1
fi

file_path="$1"

if [ ! -e "$file_path" ]; then
  echo "File not found: $file_path" >&2
  exit 1
fi

now_epoch="$(date +%s)"

if stat -f %m "$file_path" >/dev/null 2>&1; then
  # BSD/macOS stat
  mtime_epoch="$(stat -f %m "$file_path")"
elif stat -c %Y "$file_path" >/dev/null 2>&1; then
  # GNU/Linux stat
  mtime_epoch="$(stat -c %Y "$file_path")"
else
  echo "Unable to read file mtime on this system." >&2
  exit 1
fi

echo $((now_epoch - mtime_epoch))