export {};

// bun build --compile の CLI には alias が無く、ink が optional peer の
// react-devtools-core を静的 import しているためそのままでは compile できない
// (external にすると起動時に解決エラーになる)。
// ここでは plugin で空モジュールに差し替えて単一バイナリを作る。
const result = await Bun.build({
  entrypoints: ["src/index.tsx"],
  compile: { outfile: "launchpeek" },
  plugins: [
    {
      name: "stub-react-devtools",
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: "react-devtools-core-stub",
          namespace: "stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default undefined;",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log("built: launchpeek");
