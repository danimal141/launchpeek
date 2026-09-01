# launchpeek

macOS の launchd ジョブ (LaunchAgents) を Sidekiq の管理画面のように一覧・詳細・ログ確認し、その場で kickstart / enable / disable などの操作ができるターミナルアプリ。

仕様の正は [SPEC.md](./SPEC.md)。設計判断とその理由は [docs/design/architecture.md](./docs/design/architecture.md) にまとめている。

## 起動方法

```sh
# 開発実行
bun install
bun start            # = bun run src/index.tsx

# 単一バイナリ
bun run build        # = bun run scripts/build.ts → ./launchpeek
./launchpeek
```

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
bun test             # ユニットテスト (core / state)
bunx tsc --noEmit    # 型チェック
```

CI (GitHub Actions) が PR / push で両方を実行する。

## 動作確認済み

2026-09-01、macOS 14.3.1 (Darwin 23.3) + Bun 1.3.14 で以下を確認した。

- [x] 一覧に自分の LaunchAgents (27 ジョブ、user / system 両ディレクトリ) が表示される
- [x] `r` で demo ジョブを kickstart でき、pid が表示され run count が 0 → 1 に更新される
- [x] `e` / `d` で enabled が切り替わり、category が scheduled ⇔ disabled に変わる
- [x] ログのあるジョブで `l` を押すとログが表示され、表示中の追記が 1 秒以内に反映される
- [x] plist を追加すると数秒で一覧に現れ、削除すると消える。選択中のジョブは label で追従する
- [x] `u` で y/n 確認が出て、n でキャンセル、y で bootout。`U` で bootstrap し直せる
- [x] `./launchpeek` (単一バイナリ) が起動して一覧が表示される
