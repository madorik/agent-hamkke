// 커넥터(러너 + MCP 서버)를 의존성까지 묶어 resources/connector/*.mjs 로 만든다. 배포판이 앱 자신을 Node 로 써서 돌린다.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const src = (f) => fileURLToPath(new URL(`../../../packages/connector/src/${f}`, import.meta.url))
await build({
  entryPoints: [src('runner.ts'), src('claude-channel.ts')],
  outdir: fileURLToPath(new URL('../resources/connector', import.meta.url)),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // 묶인 CommonJS 의존성이 require 를 쓸 수 있게
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
})
