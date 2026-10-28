# launchpeek

[English](./README.md) | 日本語

macOS の launchd ジョブ (LaunchAgents) を Sidekiq の管理画面のように一覧・詳細・ログ確認し、その場で kickstart / enable / disable などの操作ができるターミナルアプリ。

仕様の正は [docs/spec.ja.md](./docs/spec.ja.md)。設計判断とその理由は [docs/design.md](./docs/design.md) にまとめている。

## 起動方法

```sh
# 開発実行
bun install
bun start            # = bun run src/index.tsx

# 単一バイナリ
bun run build        # = bun run scripts/build.ts → ./launchpeek
./launchpeek

# どこからでも起動できるようにする (PATH 上のディレクトリにリンクする)
ln -s "$PWD/launchpeek" ~/.local/bin/launchpeek
launchpeek
```

リンク先はリポジトリ内のバイナリなので、`bun run build` で再ビルドすればそのまま反映される。

前提: macOS 13 以降、Bun インストール済み。user ドメイン (`gui/<uid>`) のみを扱い、sudo は不要。

## 画面

- **list**: ジョブ一覧。category / label / pid / last exit / next run / schedule 要約
- **detail**: `Enter` で開く。左に縮小一覧、右に plist パス・program・schedule・pid・state・run count 等
- **logs**: `l` で開く。stdout / stderr の末尾 200 行を `[out]` / `[err]` 付きで表示し、1 秒ごとに追記を反映

category の色: busy=green / failed=red / disabled=gray / scheduled=cyan / idle=white

## キーバインド

| キー | 動作 |
| --- | --- |
| `j` / `k`, 矢印, `Ctrl+N` / `Ctrl+P` | 上下移動 |
| `g` / `G` | 先頭 / 末尾 |
| `Enter` | detail を開く |
| `l` | logs を開く |
| `y` | 選択中のジョブの label をクリップボードへコピー |
| `r` | kickstart (`launchctl kickstart -k`) |
| `e` / `d` | enable / disable |
| `u` | bootout (y/n 確認あり) |
| `U` | bootstrap |
| `x` | kill SIGTERM (y/n 確認あり) |
| `/` | フィルタ入力 (label 部分一致、大文字小文字無視)。`Enter` 確定、`Esc` 解除 |
| `R` | 手動再取得 |
| `q` / `Esc` | 一つ前のモードへ戻る。list では終了 (Esc はフィルタ解除が優先) |

## 既知の制約

- **next run は近似**。`StartInterval` のジョブは直近の実行時刻を launchd から取得できないため、`now + interval` を表示している。実際の発火時刻とはずれる
- 一覧に出るのは `~/Library/LaunchAgents` と `/Library/LaunchAgents` に plist があるジョブのみ。`launchctl list` にしか出ないジョブ (XPC サービス、`/Library/LaunchDaemons` 等) はスコープ外
- `launchctl print` の出力形式は macOS バージョンで変わりうる。パースできない項目は `-` (undefined) になり、未知の行は無視する
- 一覧の再取得は 3 秒間隔のポーリング + LaunchAgents ディレクトリの変更検知。ログは 1 秒間隔
- バイナリ化は `bun build --compile` の CLI ではなく `scripts/build.ts` (Bun.build) を使う。ink が optional peer の `react-devtools-core` を import しており、plugin で空モジュールに差し替える必要があるため

## 検証用 demo ジョブ

60 秒ごとに `date` を stdout に書くだけのジョブを同梱している。

```sh
cp test/fixtures/com.example.launchpeek-demo.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchpeek-demo.plist
# ログ: /tmp/launchpeek-demo.out.log

# 片付け
launchctl bootout gui/$(id -u)/com.example.launchpeek-demo
rm ~/Library/LaunchAgents/com.example.launchpeek-demo.plist
```

## 開発

```sh
bun run lint         # format と lint (Biome)
bun run typecheck    # 型チェック
bun test             # ユニットテスト (core / state)
bun run test:e2e     # E2E テスト
```

E2E テストは実物のアプリを疑似端末で起動し、キー入力に対する画面を確かめる。
`launchctl` は `test/e2e/fake-launchctl.ts` に、`HOME` は一時ディレクトリに差し替えるので、手元の launchd には触れない。
CI (GitHub Actions) が PR / push ですべてを実行する。

## 追加ログファイル

plist の stdout / stderr とは別のファイルへログを書くジョブは、任意の
`~/.config/launchpeek/config.json` で表示対象を追加できる。設定が無ければ従来どおり。

```json
{
  "extraLogPaths": {
    "com.example.myjob": ["~/Library/Logs/example/run.log"]
  }
}
```

label は完全一致。パスは絶対パスか `~/` 始まりで、相対パスや環境変数は使えない。
追加ログは設定順に `[log1]`、`[log2]` と表示し、同じパスは重複させない。
設定は一覧と同じ間隔で再読込する。設定の警告はログ画面とステータスバーに表示する。
壊れた項目は無視し、有効な他の項目は読み込む。存在しないファイルは読み取りエラーとして表示する。

## ログ画面の閲覧

長い行は日本語の文字幅・ANSI色・タブを考慮して折り返す。
stdout / stderr は従来どおりファイル順に表示し、初期状態は最新を追従する。

- `j` / `k`、上下矢印: 表示行単位でスクロールし、追従を停止する
- `g`: 保持しているログの先頭へ移動する
- `G`: 最新へ戻り、追従を再開する

`FOLLOW` は追従中、`PAUSED` は停止中。停止中は内容を固定し、追記・ローテーションで読んでいる内容を変えない。
`rows` は折り返し後の表示位置であり、ファイルの行番号ではない。
保持範囲は各ファイルの末尾200行。検索・過去ファイルの自動読み込みは行わない。
stderr の出力先だけを理由に本文全体を赤くせず、ログ内のANSI色指定は保持する。
