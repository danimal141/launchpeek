# launchpeek 実装指示書

このファイルは Claude Code への実装依頼書である。プロジェクト直下に置き、ここに書かれた仕様と手順に従って `launchpeek` を最後まで実装すること。判断に迷った場合は「既定の判断」の節を優先し、それでも決められない場合のみ質問する。

## 概要

macOS の launchd ジョブ（LaunchAgents）を、Sidekiq の管理画面のように一覧・詳細・ログを確認し、その場で kickstart や enable / disable などの操作ができるターミナルアプリ。

* 利用者は開発者本人のみ。ローカルで動けばよい
* Bun + TypeScript + Ink で実装する
* launchd に公開 API はないため、`launchctl` の出力と plist の読み取りに依存する

## 成果物

* `bun run src/index.tsx` で起動するアプリ
* `bun build --compile` で生成できる単一バイナリ `launchpeek`
* README（起動方法、キーバインド、既知の制約）
* データ取得層とスケジュール計算のユニットテスト

## 環境前提

* macOS 13 以降
* Bun がインストール済み
* 開発中は user ドメイン（`gui/<uid>`）のみを扱う。sudo や特権ヘルパーは不要

## 技術スタック

* ランタイム: Bun
* 言語: TypeScript（strict）
* UI: Ink、React
* plist パース: `plist` パッケージ
* プロセス実行: `Bun.spawn`
* ファイル監視: `fs.watch`
* テスト: `bun test`

依存パッケージは上記以外を原則追加しない。必要になった場合は理由をコミットメッセージに書く。

## スコープ

対象

* `~/Library/LaunchAgents` と `/Library/LaunchAgents` の plist
* ジョブ一覧、詳細、ログ tail
* kickstart、enable / disable、bootstrap / bootout、kill

対象外（実装しない）

* `/Library/LaunchDaemons` と `/System/Library/Launch*`
* plist の編集、新規作成
* 通知、常駐化

## ディレクトリ構成

```
launchpeek/
  src/
    index.tsx            エントリポイント。render(<App />)
    app.tsx              モード切り替えとキーバインド
    state.ts             reducer と Action 型
    types.ts             Job などの型定義
    core/
      plist.ts           plist の探索と読み込み
      launchctl.ts       launchctl の実行と出力パース
      merge.ts           定義と状態を Label でマージ
      schedule.ts        StartInterval / StartCalendarInterval から nextRun を計算
      actions.ts         kickstart 等のアクション
      logs.ts            ログファイルの tail
      watcher.ts         LaunchAgents ディレクトリ監視
    ui/
      Header.tsx
      JobList.tsx
      JobDetail.tsx
      LogTail.tsx
      StatusBar.tsx
      FilterInput.tsx
    util/
      exec.ts            Bun.spawn の薄いラッパ
      format.ts          列幅調整、時刻フォーマット
  test/
    plist.test.ts
    launchctl.test.ts
    schedule.test.ts
    fixtures/            launchctl print の出力サンプル、plist サンプル
  README.md
  package.json
  tsconfig.json
```

`ui/` は `core/` を直接呼ばず、`state.ts` 経由でデータを受け取る。`core/` は Ink に依存しない。

## 型定義

`src/types.ts` は以下を基本にする。必要に応じてフィールドを追加してよいが、削除・改名はしない。

```ts
export type Domain = "user" | "system";

export type JobState =
  | "running"
  | "waiting"
  | "disabled"
  | "not-loaded"
  | "unknown";

export interface CalendarInterval {
  minute?: number;
  hour?: number;
  day?: number;
  weekday?: number;
  month?: number;
}

export interface JobDefinition {
  label: string;
  plistPath: string;
  domain: Domain;
  program?: string;
  arguments: string[];
  startInterval?: number;
  startCalendarInterval?: CalendarInterval[];
  keepAlive: boolean;
  runAtLoad: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  workingDirectory?: string;
  raw: Record<string, unknown>;
}

export interface JobRuntime {
  label: string;
  loaded: boolean;
  pid?: number;
  state: JobState;
  lastExitCode?: number;
  runCount?: number;
  enabled: boolean;
}

export interface Job extends JobDefinition {
  runtime: JobRuntime;
  nextRun?: Date;
  category: "busy" | "scheduled" | "failed" | "idle" | "disabled";
}

export type ActionKind =
  | "kickstart"
  | "enable"
  | "disable"
  | "bootstrap"
  | "bootout"
  | "kill";

export interface ActionResult {
  ok: boolean;
  message: string;
}
```

category の判定規則

* busy: pid がある
* failed: lastExitCode が 0 以外
* disabled: enabled が false、または loaded が false
* scheduled: nextRun が計算できる
* idle: 上記以外

判定は上から順に評価し、最初に一致したものを採用する。

## plist 読み込み仕様

* `~/Library/LaunchAgents/*.plist` と `/Library/LaunchAgents/*.plist` を列挙する
* 読めないファイルはスキップし、警告として state に積む（アプリは落とさない）
* バイナリ plist にも対応する（`plist` パッケージで読めない場合は `plutil -convert xml1 -o - <path>` にフォールバック）
* `Label` が無い plist は無視する
* `Program` が無く `ProgramArguments` がある場合は先頭要素を program とみなす
* `StartCalendarInterval` は dict でも dict の配列でも受け付け、必ず配列に正規化する
* `KeepAlive` は bool でも dict でも受け付け、dict の場合は true とみなす

## launchctl 仕様

すべて `util/exec.ts` 経由で非同期に実行する。タイムアウトは 5 秒。

一覧取得

* `launchctl list` を実行し、各行の `PID` `Status` `Label` を読む
* PID が `-` の場合は未実行、数値なら running
* Status は last exit code として扱う（負数はシグナル）

詳細取得

* `launchctl print gui/<uid>/<label>` を実行する
* 出力から以下を正規表現で拾う。取れない項目は undefined にする
  * `pid = <n>`
  * `state = <word>`
  * `last exit code = <n>` または `last exit code = (never exited)`
  * `run count = <n>` または `runs = <n>`
* 終了コードが 0 以外（ジョブが未ロード）の場合は loaded を false にする
* 出力形式は macOS のバージョンで変わりうるため、パーサは `test/fixtures/` の複数サンプルで検証し、未知の行は無視する

enabled 判定

* `launchctl print-disabled gui/<uid>` を一度だけ実行し、`"<label>" => disabled` の行を集めて判定する

uid の取得

* `process.getuid()` を使う

## スケジュール計算仕様

`core/schedule.ts` の `nextRun(def: JobDefinition, now: Date): Date | undefined`

* `StartInterval` がある場合: 直近の実行時刻は不明なので `now + StartInterval` 秒を返す（近似であることを README に明記）
* `StartCalendarInterval` がある場合: 各 CalendarInterval について、now 以降で最初に条件を満たす時刻を分単位で探索し、最も早いものを返す。探索上限は 366 日
* 指定されていないフィールドはワイルドカードとして扱う（cron と同じ）
* weekday は 0 と 7 を日曜として扱う
* どちらも無い場合は undefined

このモジュールは純粋関数にし、テストを最も厚く書く。

## アクション仕様

`core/actions.ts` の `runAction(kind: ActionKind, job: Job): Promise<ActionResult>`

* kickstart: `launchctl kickstart -k gui/<uid>/<label>`
* enable: `launchctl enable gui/<uid>/<label>`
* disable: `launchctl disable gui/<uid>/<label>`
* bootstrap: `launchctl bootstrap gui/<uid> <plistPath>`
* bootout: `launchctl bootout gui/<uid>/<label>`
* kill: `launchctl kill SIGTERM gui/<uid>/<label>`

* 終了コード 0 なら ok。それ以外は stderr の先頭行を message にする
* 実行後は必ず状態を再取得する
* bootout と kill は実行前に StatusBar で `y` の確認を求める

## ログ仕様

`core/logs.ts`

* stdoutPath と stderrPath を対象にする。両方ある場合は行頭に `[out]` `[err]` を付けて時系列順に混ぜず、ファイルごとに末尾 N 行を読んで連結する
* N は 200 とし、state にはこの分だけ保持する
* logs モードの間は 1 秒ごとにファイルサイズを確認し、増えていれば差分を読む
* ファイルが存在しない、または読めない場合はその旨を表示する

## UI 仕様

### 画面モード

list

* 上部に Header、中央に JobList、下部に StatusBar
* 端末の高さに合わせて表示行数を決め、選択行が常に見えるようスクロールする
* 列: category、label、pid、last exit、next run、schedule 要約
* category ごとに色を分ける（busy: green、failed: red、disabled: gray、scheduled: cyan、idle: white）

detail

* 左に JobList を縮小表示、右に JobDetail
* JobDetail は label、plistPath、program と arguments、schedule、keepAlive / runAtLoad、stdout / stderr パス、pid、state、lastExitCode、runCount、nextRun を表示

logs

* 全画面で LogTail。上部 1 行に label とファイルパス

### キーバインド

* `j` / `k` または矢印: 上下移動
* `g` / `G`: 先頭 / 末尾
* `Enter`: detail を開く
* `l`: logs を開く
* `r`: kickstart
* `e`: enable
* `d`: disable
* `u`: bootout（確認あり）
* `U`: bootstrap
* `x`: kill（確認あり）
* `/`: フィルタ入力。label の部分一致。`Esc` で解除
* `R`: 手動で再取得
* `q` / `Esc`: 一つ前のモードへ戻る。list で押した場合は終了

### StatusBar

* 通常時: 現在モードで使えるキーの一覧
* アクション実行後: 結果メッセージを 3 秒表示して元に戻す
* 確認待ち: `bootout <label>? (y/n)` のように表示

## 状態管理

`src/state.ts` で `useReducer` 用の reducer を定義する。

```ts
export interface AppState {
  jobs: Job[];
  warnings: string[];
  selectedIndex: number;
  mode: "list" | "detail" | "logs";
  filter: string;
  filterEditing: boolean;
  message?: string;
  pendingConfirm?: { kind: ActionKind; job: Job };
  logLines: string[];
  lastUpdated?: Date;
  loading: boolean;
}
```

* 一覧の再取得は 3 秒間隔のポーリング。`watcher.ts` が plist の変更を検知した場合は即時再取得する
* 再取得中も UI は操作できる。前回の jobs を表示したまま差し替える
* 選択中の label は再取得後も維持する（index ではなく label で追従する）

## 非機能要件

* launchctl の呼び出しは並列数を 8 に制限する
* アプリはどんな例外でも落ちず、warnings か message に出す
* 起動から初回描画までは `launchctl list` の結果だけで行い、`launchctl print` の詳細は後から埋める
* ジョブ数 100 程度で操作が引っかからないこと

## 作業手順

以下の順に進め、各ステップの終わりで動作確認とコミットを行う。

* プロジェクト初期化: `bun init`、依存追加、tsconfig（strict、jsx: react-jsx）、`bun run` と `bun test` が通る空の App
* `core/launchctl.ts` の `list` パースとテスト。`test/fixtures/launchctl-list.txt` を用意する
* `JobList` と `Header` を作り、j / k で選択できる list モードを完成させる
* `core/plist.ts` と `core/merge.ts`、`core/launchctl.ts` の `print` パースを実装し、Job モデルを完成させる。fixtures を追加する
* `core/schedule.ts` とテスト。一覧に next run を表示する
* detail モードと `JobDetail`
* logs モードと `LogTail`
* `core/actions.ts` と各キーバインド、確認フロー、StatusBar のメッセージ表示
* `watcher.ts` とポーリングの統合、label による選択追従
* `bun build --compile src/index.tsx --outfile launchpeek` でバイナリ化し、README を書く

## 検証方法

* `bun test` が全て通ること
* 自分の環境で以下を手動確認し、README の「動作確認済み」に記録する
  * 一覧に自分の LaunchAgents が表示される
  * `r` で任意のジョブを kickstart でき、pid と run count が更新される
  * `e` / `d` で enabled が切り替わる
  * ログのあるジョブで `l` を押すとログが表示され、追記が反映される
  * plist を追加・削除すると一覧に反映される
* 検証用に `test/fixtures/com.example.launchpeek-demo.plist`（60 秒ごとに date を stdout に書くだけのジョブ）を用意し、README に bootstrap 手順を書く

## コーディング規約

* TypeScript strict。`any` は使わない。外部入力（launchctl 出力、plist）は unknown から絞り込む
* `core/` は Ink と React に依存しない純粋なモジュールにする
* 非同期処理は必ず try / catch し、失敗は戻り値か warnings で伝える
* コメントは「なぜ」を書く。launchctl の出力形式に依存している箇所には必ずその旨を書く
* フォーマットは `bun fmt` 相当（Prettier 既定）に従う
* コミットは作業手順の単位で分ける

## やってはいけないこと

* `launchctl` の出力形式を決め打ちして、未知の行で例外を投げる
* system ドメインや sudo を必要とする処理を追加する
* plist を書き換える
* ログ全体を state に読み込む
* 指示にない UI ライブラリ（ink-table 等）を追加する

## 既定の判断

迷ったら次のとおりにする。

* ポーリング間隔は 3 秒、ログは 1 秒
* `launchctl print` に失敗したジョブは `launchctl list` の情報だけで表示し、state は unknown にする
* 端末幅が 80 未満のときは next run と schedule の列を省略する
* 色は Ink の標準色名のみ使う
* 日時は `MM-DD HH:mm` のローカル時刻で表示する
* フィルタは大文字小文字を区別しない
* テストが書きにくい箇所は fixtures を増やしてでもテストを書く。UI のテストは不要

## 完了の定義

* 作業手順のすべてが完了し、コミットされている
* `bun test` が通る
* 検証方法の手動確認がすべて済み、README に記録されている
* `launchpeek` バイナリが生成され、起動して一覧が表示される
