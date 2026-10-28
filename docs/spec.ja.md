# launchpeek 仕様

この文書には、目的、スコープ、守るべき制約、既定値を書く。テストでは表せないものだけを残している。

* 細かな振る舞い（category の判定、スケジュール計算、plist の読み込み規則、launchctl のパース、ログの再読込条件など）は、ユニットテスト（`test/*.test.ts`）が正
* 画面とキー操作の振る舞いは、E2E テスト（`test/e2e/`）と README が正
* 判断の理由は [design.md](./design.md) にある

英訳を [spec.md](./spec.md) に置いている。内容が食い違うときはこのファイルを正とし、英訳を追従させる。

## 目的

macOS の launchd ジョブ（LaunchAgents）を、Sidekiq の管理画面のように一覧・詳細・ログで確認し、その場で kickstart や enable / disable などの操作ができるターミナルアプリ。

* 利用者は開発者本人。ローカルで動けばよい
* launchd に公開 API はないため、`launchctl` の出力と plist の読み取りに依存する

## 前提

* macOS 13 以降、Bun がインストール済み
* user ドメイン（`gui/<uid>`）のみを扱う。sudo や特権ヘルパーは使わない

## スコープ

対象

* `~/Library/LaunchAgents` と `/Library/LaunchAgents` に plist があるジョブ
* ジョブ一覧、詳細、ログの tail
* kickstart、enable / disable、bootstrap / bootout、kill

対象外（実装しない）

* `/Library/LaunchDaemons` と `/System/Library/Launch*`
* `launchctl list` にしか出ないジョブ（XPC サービスなど）
* plist の編集、新規作成
* 通知、常駐化

## 制約

* `launchctl` の出力形式を決め打ちしない。出力は macOS のバージョンで変わりうるので、未知の行は無視し、取れない項目は undefined にする
* system ドメインや sudo を必要とする処理を追加しない
* plist を書き換えない
* ログ全体を state に読み込まない。保持するのは末尾 200 行まで
* 取り消せない操作（bootout と kill）は、実行前に `y` で確認を求める
* `core/` は Ink と React に依存しない。`ui/` は `core/` を直接呼ばず、`state.ts` 経由でデータを受け取る
* 依存パッケージは原則追加しない。追加するときは理由をコミットメッセージに書く。指示にない UI ライブラリ（ink-table など）は使わない

## 非機能要件

* launchctl の呼び出しは並列数を 8 に制限し、1 回あたり 5 秒でタイムアウトする
* アプリはどんな例外でも落ちず、warnings か message に出す
* 起動から初回描画までは plist の定義と `launchctl list` の結果だけで行い、`launchctl print` の詳細は後から埋める
* ジョブ数 100 程度で操作が引っかからない

## 既定値

仕様として決めた値。変えるときはこの文書も更新する。

* 一覧の再取得は 3 秒間隔のポーリング。plist の変更を検知したら即時に再取得する
* ログは logs モードの間、1 秒間隔で追記を確認する
* アクション結果のメッセージは 3 秒で消す
* `StartInterval` のジョブの next run は `now + StartInterval` の近似で出す。直近の実行時刻を launchd から取れないため
* `StartCalendarInterval` の next run の探索上限は 366 日
* 端末幅が 80 未満のときは next run と schedule の列を省く
* 色は Ink の標準色名のみ使う
* 日時は `MM-DD HH:mm` のローカル時刻で表示する
* フィルタは大文字小文字を区別しない
