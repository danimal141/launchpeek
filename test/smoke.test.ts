import { expect, test } from "bun:test";

// 本実装のテストが入るまでの placeholder。bun test はテスト 0 件だと失敗するため置いている
test("smoke", () => {
  expect(true).toBe(true);
});
