# AGENTS.md

## コマンド

* `bun run lint`: Biome で format と lint をチェックする（CI と同じ）
* `bun run format`: Biome の自動修正を適用する
* `bun run typecheck` / `bun test`: 型チェックとテスト

変更後は上の 3 つ（lint、typecheck、test）が通ることを確認する。

## 前提と注意点

* 振る舞いの正は SPEC.md。仕様を変える変更では SPEC.md も更新する
* CI は ubuntu で動く。テストは `test/fixtures/` の出力サンプルを使う純粋関数だけを対象にし、実際の `launchctl` や `~/Library/LaunchAgents` に触れるテストは書かない
* 整形を一括適用したコミットは `.git-blame-ignore-revs` にハッシュを登録する。その PR は squash や rebase ではなく merge commit で取り込む（ハッシュが変わると無視されなくなる）

## コメント

コードを読めばわかることはコメントに書かない。コメントはコードから読み取れない情報のためにある。

書くもの:

* その実装を選んだ理由や制約（例: 「launchctl の出力形式は macOS バージョンで変わりうるため、未知の行は無視する」）
* 仕様に由来する振る舞いの根拠。SPEC.md が出典なら末尾に `(SPEC)` を付ける
* 一見不自然に見えるが意図的な書き方の説明

書かないもの:

* 次の行の処理をそのまま言い換えたもの（例: `// ジョブを取得する` の直後に `getJobs()`）
* 関数名・変数名・型から明らかな説明
* 変更履歴や作業メモ（「〜に修正」「〜を追加」「TODO: 後で直す」など）。履歴は git に残す
* コメントアウトしたコード

lint の抑止（`biome-ignore`）には、抑止する理由を必ず書く。
