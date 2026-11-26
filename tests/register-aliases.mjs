import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'

const aliases = {
  '@shared/': new URL('../src/shared/', import.meta.url),
  '@core/': new URL('../src/core/', import.meta.url),
  '@renderer/': new URL('../src/renderer/', import.meta.url)
}

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.ts')) {
      const source = readFileSync(new URL(url), 'utf8')
      return {
        format: 'module',
        source: ts.transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
        }).outputText,
        shortCircuit: true
      }
    }
    return nextLoad(url, context)
  },
  resolve(specifier, context, nextResolve) {
    for (const [prefix, target] of Object.entries(aliases)) {
      if (specifier.startsWith(prefix)) {
        return nextResolve(new URL(`${specifier.slice(prefix.length)}.ts`, target).href, context)
      }
    }
    if (specifier.startsWith('.') && context.parentURL) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
        if (specifier.endsWith('.ts')) throw error
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  }
})
