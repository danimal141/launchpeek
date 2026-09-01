# launchpeek 設計方針

launchpeek は launchd の LaunchAgents を一覧・操作するターミナルアプリである。要求仕様は [SPEC.md](../../SPEC.md) にあり、本書は実装にあたって置いた設計判断とその理由をまとめる。仕様と実装が食い違って見えたときは、まず本書の「仕様の解釈」を確認するとよい。

## 前提: launchd に公開 API はない

設計全体を規定する制約は、launchd の状態を取得する公開 API が存在しないことである。すべての情報は `launchctl` サブコマンドの出力テキストと plist ファイルの読み取りに依存する。この出力形式は Apple が互換性を保証しておらず、macOS のバージョンで変わりうる。

この制約から、次の方針を全パーサに適用している。

* 解釈できない行は黙って無視し、例外を投げない
* 取れない項目は undefined のまま残し、UI 側は `-` として表示する
* パーサは実出力から採取した fixture で検証し、形式が変わったら fixture を追加して追随する

「未知の入力で落ちない」ことをアプリ全体の不変条件とし、失敗は warnings（state に積んで StatusBar に件数表示）か ActionResult の message として表面化させる。

## レイヤ構成

```
ui/ (Ink コンポーネント)
 ↑ props
state.ts (reducer と Action 型)
 ↑ dispatch
app.tsx (キーバインド、データ取得のオーケストレーション)
 ↓ 呼び出し
core/ (純粋モジュール群。Ink / React に依存しない)
 ↓
util/ (exec, format)
```

**core/** は Ink と React に依存しない。launchctl の実行とパース（launchctl.ts）、plist の探索と正規化（plist.ts）、両者の Label によるマージ（merge.ts）、次回実行時刻の計算（schedule.ts）、アクション実行（actions.ts）、ログの tail（logs.ts）、ディレクトリ監視（watcher.ts）を持つ。UI から切り離した理由はテストにある。この層が `bun test` の対象のほぼすべてであり、fixture を食わせるだけで検証できる。

**ui/** は core/ を直接呼ばない。データは state.ts の AppState として受け取り、描画だけを行う。UI のテストは書かない（SPEC の既定の判断）。

**app.tsx** が唯一の接着点である。core/ の非同期関数を呼んで dispatch し、キー入力をハンドリングする。ポーリングやログ tail の effect もここに置く。

## Job モデルとデータフロー

Job は plist 由来の静的な定義（JobDefinition）と launchctl 由来の動的な状態（JobRuntime）を Label でマージしたものである。マージの正は定義側に置く。つまり一覧に出るのは、両 LaunchAgents ディレクトリに plist があるジョブだけである（理由は後述の「仕様の解釈」）。

取得は二段階に分ける。

1. **即時**: plist 定義の読み込みと `launchctl list`（1 プロセス）。この 2 つだけで一覧を描画する
2. **後埋め**: `launchctl print`（ジョブ数ぶんのプロセス起動）と `print-disabled`。完了したら同じ jobs-updated action で差し替える

`launchctl print` はジョブごとに 1 プロセス必要で、これを待つと初回描画が数秒遅れる。一方 plist と list は 100 ジョブ程度なら瞬時に揃う。二段階に分けることで、起動直後から一覧が見え、詳細（run count、正確な state、enabled）が後から埋まる。

再取得はこのフローの再実行であり、3 秒間隔のポーリングと、watcher.ts による plist 変更検知（fs.watch、300ms debounce）の両方から起動される。`refreshing` フラグで多重実行を防ぎ、取得中も前回の jobs を表示したまま操作を受け付ける。

launchctl の同時実行は util/exec.ts のセマフォで 8 に制限する。print の後埋めがジョブ数ぶんの呼び出しを一斉に発行するため、無制限だと launchd 側を詰まらせるおそれがある。タイムアウトは一律 5 秒とし、spawn の失敗もタイムアウトも ExecResult（exitCode -1）として返す。

## category 判定

一覧の色分けに使う category は、runtime から次の順で最初に一致したものを採用する。

1. **busy**: pid がある
2. **failed**: lastExitCode が 0 以外
3. **disabled**: enabled でない、またはロードされていない
4. **scheduled**: nextRun が計算できる
5. **idle**: 上記以外

順序が仕様の一部である。実行中のジョブは過去の失敗より「動いている」ことを優先して見せ、無効化されたジョブにはスケジュールを表示しない（launchd に発火予定がないため、merge の段階で nextRun 自体を計算しない）。

## nextRun は近似である

schedule.ts の `nextRun` は純粋関数で、テストを最も厚く書いている。ただし返す値の精度は入力によって異なる。

* **StartCalendarInterval**: cron と同じ意味論で、now 以降で最初に条件を満たす分を返す。これは正確である。探索は月・日・時・分のミスマッチした単位ごとにまとめて前進させ、上限 366 日で打ち切る（day=31 と month=2 のような充足不能な指定を有限時間で諦めるため）
* **StartInterval**: launchd は「前回実行から N 秒後」に発火するが、前回実行時刻を外部から取得できない。そこで `now + N 秒` を表示する。次の発火が最も遅くてもこの時刻までには来る、という上界の近似である

この差は UI からは見えないため、README の既知の制約に明記している。

## ログの tail

方針は「ログ全体をメモリに載せない」である。logs.ts は末尾 256KB だけを読んで最大 200 行を切り出し、以後は 1 秒ごとにファイルサイズを比較して増分だけを読む。サイズが縮んだ場合（ローテーション）と、消えたファイルが復活した場合は末尾から読み直す。

stdout と stderr は時系列にマージしない。行にタイムスタンプがある保証がなく、正しい順序復元が原理的にできないためである。代わりにファイルごとに連結し、`[out]` / `[err]` プレフィクスで区別する。

## アクションと確認フロー

アクションはすべて `launchctl` のサブコマンド 1 つに 1 対 1 で対応させ、コマンド組み立て（actionCommand）を純粋関数に分離してテストする。実行後は必ず状態を再取得する。launchctl は成功してもほとんど何も出力しないため、再取得後の表示だけが結果の確認手段になる。

bootout と kill だけは実行前に y/n の確認を挟む。この 2 つを選んだ基準は取り消しの難しさである。kickstart や enable/disable は逆操作が自明だが、bootout は plist のパスを知らないと戻せず、kill は実行中の処理を失わせる。

## 状態管理の要点

reducer（state.ts）で押さえている点は 2 つある。

第一に、**選択の追従は index ではなく label で行う**。ポーリングで jobs が差し替わるたびに並びや件数が変わりうるため、index を保持すると選択が別のジョブに飛ぶ。jobs-updated とフィルタ変更の両方で、直前に選択していた label を新しい一覧から探し直す。

第二に、**フィルタ編集は reducer 内で完結する相対操作**（append / backspace / clear）にする。キー入力はペーストや高速連打で複数文字が 1 チャンクで届くことがあり、app.tsx はそれを 1 文字ずつハンドラに回す。このときハンドラが閉じ込めた state は再レンダリング前の古い値なので、「現在のフィルタ + 入力」を action に載せる絶対値方式だと最後の 1 文字しか残らない。相対操作なら reducer が常に最新の state に適用するため、この問題が起きない。

## 仕様の解釈

実装中に判断が必要になった点と、その結論を記す。

**一覧の範囲**: `launchctl list` は LaunchAgents 以外のジョブ（XPC サービスなど）を 400 件以上返すが、一覧には載せない。SPEC のスコープが両 LaunchAgents ディレクトリの plist であり、非機能要件も 100 ジョブ程度を想定しているためである。「初回描画は launchctl list の結果だけで行う」という記述は、「print を待たない」の意味に解釈した（plist の読み込みはローカル I/O のみで list と同等に速く、範囲の確定に必要）。

**バイナリ plist の読み方**: SPEC は plutil へのフォールバックを指定しているが、plist パッケージ v5 が `parseBinary` を提供しているため、XML → parseBinary → plutil の三段にした。parseBinary を挟む理由は CI にある。テストは Linux ランナーで走るため、plutil（macOS 専用）に依存すると バイナリ plist の読み込みを CI で検証できない。

**launchctl print の state 表記**: 出力には `running` `not running` `waiting` などが現れる。JobState には対応する値がないものもあるため、running と waiting だけをそのまま写し、それ以外は unknown に落とす。未ロード時は enabled の値によって not-loaded と disabled を使い分ける。

## ビルド

単一バイナリは `bun build --compile` の CLI ではなく scripts/build.ts（Bun.build の compile オプション）で作る。ink が optional peer の react-devtools-core を静的に import しており、CLI では解決に失敗し、`--external` を付けても実行時の解決エラーに変わるだけだった。ビルドスクリプトでは plugin の onResolve でこのパッケージを空モジュールに差し替えている。devtools は `DEV=true` のときだけ動く開発機能であり、差し替えても製品の挙動に影響はない。

## テスト方針

テストは core/ と state.ts に集中させ、UI には書かない。外部コマンドの出力に依存する箇所は、実環境から採取した fixture（launchctl list / print / print-disabled の出力、各種 plist）を test/fixtures/ に置いて検証する。schedule.ts は境界（月末、うるう日、weekday の折返し、充足不能な指定）を最も厚くテストする。

手動でしか確認できない項目（kickstart で run count が増える、ログ追記の反映、plist 追加・削除の反映）は、検証用の demo ジョブ（60 秒ごとに date を書くだけの plist）を bootstrap して確認し、結果を README の「動作確認済み」に記録する。

## 開発フロー

1 機能 = 1 Issue = 1 ブランチ = 1 PR とし、CI（型チェックとテスト）green を確認してマージする。コミットは Conventional Commits 形式で小さく分け、squash せずマージ履歴に残す。launchctl の出力形式に依存する箇所には、その旨をコメントで明記する。
