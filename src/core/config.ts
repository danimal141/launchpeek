import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

// ユーザー設定。plist から読めないログファイルを label に紐付けて補うためだけに使う
export interface UserConfig {
  // key は launchd の Label 完全一致。値は解決済みの絶対パス
  extraLogPaths: Record<string, string[]>;
}

export interface ConfigLoadResult {
  config: UserConfig;
  warnings: string[];
}

// 共有インスタンスを変異させないよう毎回新しく作る。
// label は外部入力なので prototype 無しにする。"__proto__" や "constructor" を
// キーにしても、プロトタイプを書き換えたり関数を引き当てたりしない
export function emptyConfig(): UserConfig {
  return { extraLogPaths: Object.create(null) as Record<string, string[]> };
}

export function defaultConfigPath(): string {
  return join(homedir(), ".config/launchpeek/config.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// シェルを介さないので展開するのは先頭の ~ だけ。$VAR や相対パスは扱わない
export function resolveLogPath(value: string): string | undefined {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return normalize(join(homedir(), value.slice(2)));
  if (isAbsolute(value)) return normalize(value);
  return undefined;
}

function parseLabelPaths(
  label: string,
  raw: unknown,
  warnings: string[],
): string[] {
  if (!Array.isArray(raw)) {
    warnings.push(
      `extraLogPaths.${label}: 配列ではありません (${typeof raw})。この label の追加ログは無視します`,
    );
    return [];
  }
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      warnings.push(
        `extraLogPaths.${label}: 文字列ではない要素を無視しました (${typeof entry})`,
      );
      continue;
    }
    if (entry === "") {
      warnings.push(`extraLogPaths.${label}: 空文字列のパスを無視しました`);
      continue;
    }
    const path = resolveLogPath(entry);
    if (path === undefined) {
      warnings.push(
        `extraLogPaths.${label}: "${entry}" は絶対パスか ~/ 始まりで書いてください (相対パスと $VAR は非対応)`,
      );
      continue;
    }
    // 同じファイルを二重に表示しない
    if (seen.has(path)) continue;
    seen.add(path);
    resolved.push(path);
  }
  return resolved;
}

// 壊れている label だけを落とし、他の label は生かす (SPEC 非機能要件: 落とさず warnings に出す)
export function parseConfig(raw: unknown): ConfigLoadResult {
  const warnings: string[] = [];
  const config = emptyConfig();
  if (!isRecord(raw)) {
    warnings.push(
      "設定ファイルのトップレベルが object ではありません。設定を無視します",
    );
    return { config, warnings };
  }
  for (const key of Object.keys(raw)) {
    // typo を気付けるようにするため、未知のキーは黙って捨てない
    if (key !== "extraLogPaths") {
      warnings.push(`設定の未知のキー "${key}" を無視しました`);
    }
  }
  const extra = raw["extraLogPaths"];
  if (extra === undefined) return { config, warnings };
  if (!isRecord(extra)) {
    warnings.push(
      `extraLogPaths は label をキーにした object で書いてください (${Array.isArray(extra) ? "array" : typeof extra})`,
    );
    return { config, warnings };
  }
  for (const [label, value] of Object.entries(extra)) {
    if (label === "") {
      warnings.push("extraLogPaths: 空の label を無視しました");
      continue;
    }
    const paths = parseLabelPaths(label, value, warnings);
    if (paths.length > 0) config.extraLogPaths[label] = paths;
  }
  return { config, warnings };
}

// テストからパスを差し替えられるよう引数で受ける (watchAgentDirs と同じ方式)
export async function loadConfig(
  path = defaultConfigPath(),
): Promise<ConfigLoadResult> {
  let text: string;
  try {
    const file = Bun.file(path);
    // 設定ファイルが無いのは通常の状態なので警告しない
    if (!(await file.exists())) return { config: emptyConfig(), warnings: [] };
    text = await file.text();
  } catch (err) {
    return {
      config: emptyConfig(),
      warnings: [`設定ファイルを読めません (${path}): ${String(err)}`],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      config: emptyConfig(),
      warnings: [`設定ファイルの JSON が壊れています (${path}): ${String(err)}`],
    };
  }
  return parseConfig(raw);
}

export function extraLogPathsFor(
  config: UserConfig,
  label: string,
): string[] {
  // UserConfig を素の object リテラルから組んだ呼び出し元もありうるので、
  // ここでも own property だけを見る (label は plist 由来の外部入力)
  if (!Object.hasOwn(config.extraLogPaths, label)) return [];
  const paths = config.extraLogPaths[label];
  return Array.isArray(paths) ? paths : [];
}
