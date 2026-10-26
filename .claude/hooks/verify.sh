#!/usr/bin/env bash
# Stop hook: lint / typecheck / test / e2e が通るまでターンを終わらせない。
# 失敗時は exit 2 で stderr を Claude に返し、修正を続けさせる。
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# 質問への回答だけのターンで毎回テストを回さないよう、検査対象に変更が無ければ通す
if [ -z "$(git status --porcelain -- src test scripts package.json bun.lock biome.json tsconfig.json)" ]; then
  exit 0
fi

for cmd in "bun run lint" "bun run typecheck" "bun test" "bun run test:e2e"; do
  if ! out=$($cmd 2>&1); then
    {
      echo "\`$cmd\` が失敗しました。修正してから終了してください。"
      echo "$out" | tail -n 40
    } >&2
    exit 2
  fi
done
