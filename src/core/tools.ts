import { z } from 'zod'
import type { ApprovalType, Mode } from '@shared/types'
import type { ToolSpec } from './providers/types'

export interface ToolContext {
  projectPath: string | null
  resolve(rel: string): { abs: string; inside: boolean }
  readFile(rel: string): Promise<string>
  readFileRaw(rel: string): Promise<string>
  writeFile(rel: string, content: string, signal?: AbortSignal): Promise<void>
  listDir(rel: string): Promise<{ name: string; kind: 'file' | 'dir' }[]>
  search(query: string, glob?: string): Promise<{ path: string; line: number; text: string }[]>
  runCommand(command: string, signal?: AbortSignal): Promise<{ output: string; exitCode: number }>
  readMemory(): Promise<string>
  checkpoint(paths: string[], signal?: AbortSignal): Promise<void>
}

export interface ToolDef<A = any> {
  name: string
  description: string
  schema: z.ZodType<A>
  approval: ApprovalType | null
  modes: Mode[]
  run(args: A, ctx: ToolContext, signal?: AbortSignal): Promise<string>
}

const pathArg = z.string().min(1).describe('Path relative to the project root.')

export function createTools(): ToolDef[] {
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the project. Returns content with line numbers.',
      schema: z.object({ path: pathArg, start: z.number().int().min(1).optional(), end: z.number().int().min(1).optional() }),
      approval: null,
      modes: ['ask', 'agent', 'full'],
      async run(args, ctx) {
        const text = await ctx.readFile(args.path)
        const lines = text.split('\n')
        const s = Math.max(1, args.start ?? 1)
        const e = Math.min(lines.length, args.end ?? lines.length)
        return lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n').slice(0, 24000)
      }
    },
    {
      name: 'list_directory',
      description: 'List files and folders at a project-relative path. Use "." for the root.',
      schema: z.object({ path: pathArg }),
      approval: null,
      modes: ['ask', 'agent', 'full'],
      async run(args, ctx) {
        const entries = await ctx.listDir(args.path)
        return entries.map((e) => `${e.kind === 'dir' ? 'd' : 'f'} ${e.name}`).join('\n') || '(empty)'
      }
    },
    {
      name: 'search_code',
      description: 'Search project files for a literal string. Returns path:line matches.',
      schema: z.object({ query: z.string().min(1), glob: z.string().optional() }),
      approval: null,
      modes: ['ask', 'agent', 'full'],
      async run(args, ctx) {
        const hits = await ctx.search(args.query, args.glob)
        return hits.length
          ? hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n').slice(0, 16000)
          : 'No matches.'
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with the full new content. Follows the active access mode.',
      schema: z.object({ path: pathArg, content: z.string() }),
      approval: 'write',
      modes: ['agent', 'full'],
      async run(args, ctx, signal) {
        signal?.throwIfAborted()
        await ctx.checkpoint([args.path], signal)
        signal?.throwIfAborted()
        await ctx.writeFile(args.path, args.content, signal)
        signal?.throwIfAborted()
        return `Wrote ${args.content.length} chars to ${args.path}.`
      }
    },
    {
      name: 'edit_file',
      description: 'Replace an exact, unique search string in a file. Follows the active access mode.',
      schema: z.object({ path: pathArg, search: z.string().min(1), replace: z.string() }),
      approval: 'edit',
      modes: ['agent', 'full'],
      async run(args, ctx, signal) {
        signal?.throwIfAborted()
        const before = await ctx.readFileRaw(args.path)
        signal?.throwIfAborted()
        const first = before.indexOf(args.search)
        if (first < 0) return 'Error: search text not found. Read the file and retry with an exact match.'
        if (before.indexOf(args.search, first + 1) >= 0) return 'Error: search text is not unique. Include more surrounding lines.'
        await ctx.checkpoint([args.path], signal)
        signal?.throwIfAborted()
        await ctx.writeFile(args.path, before.replace(args.search, args.replace), signal)
        signal?.throwIfAborted()
        return `Edited ${args.path}.`
      }
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the project folder, visible in the terminal. Follows the active access mode.',
      schema: z.object({ command: z.string().min(1) }),
      approval: 'command',
      modes: ['agent', 'full'],
      async run(args, ctx, signal) {
        const { output, exitCode } = await ctx.runCommand(args.command, signal)
        return `exit ${exitCode}\n${output.slice(0, 16000)}`
      }
    },
    {
      name: 'read_memory',
      description: 'Read PROJECT.md, the durable project memory file.',
      schema: z.object({}),
      approval: null,
      modes: ['ask', 'agent', 'full'],
      async run(_args, ctx) {
        return (await ctx.readMemory()) || '(PROJECT.md is empty)'
      }
    },
    {
      name: 'propose_memory',
      description: 'Propose new PROJECT.md content. Shown to the user as a diff and follows the active access mode.',
      schema: z.object({ content: z.string() }),
      approval: 'memory',
      modes: ['agent', 'full'],
      async run(args, ctx, signal) {
        signal?.throwIfAborted()
        await ctx.checkpoint(['PROJECT.md'], signal)
        signal?.throwIfAborted()
        await ctx.writeFile('PROJECT.md', args.content, signal)
        signal?.throwIfAborted()
        return 'PROJECT.md updated.'
      }
    },
    {
      name: 'update_plan',
      description: 'Publish or update the visible plan. Call this first on multi-step work, then keep statuses current.',
      schema: z.object({
        steps: z.array(z.object({
          text: z.string().min(1),
          status: z.enum(['pending', 'running', 'done', 'failed'])
        })).min(1).max(12)
      }),
      approval: null,
      modes: ['ask', 'agent', 'full'],
      async run() {
        return 'Plan updated.'
      }
    }
  ]
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  constructor(defs: ToolDef[]) {
    for (const t of defs) this.tools.set(t.name, t)
  }
  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }
  specsFor(mode: Mode): ToolSpec[] {
    return [...this.tools.values()]
      .filter((t) => t.modes.includes(mode))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema)
      }))
  }
}

// Minimal zod-to-JSON-Schema for the object shapes used above.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convert(schema)
}

function convert(s: z.ZodTypeAny): Record<string, unknown> {
  const def: any = (s as any)._def
  const desc = def.description
  const withDesc = (o: Record<string, unknown>) => (desc ? { ...o, description: desc } : o)
  if (s instanceof z.ZodOptional) return convert(def.innerType)
  if (s instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [k, v] of Object.entries(def.shape())) {
      const inner = v as z.ZodTypeAny
      properties[k] = convert(inner)
      if (!(inner instanceof z.ZodOptional)) required.push(k)
    }
    return withDesc({ type: 'object', properties, required, additionalProperties: false })
  }
  if (s instanceof z.ZodString) return withDesc({ type: 'string' })
  if (s instanceof z.ZodNumber) return withDesc({ type: def.checks?.some((c: any) => c.kind === 'int') ? 'integer' : 'number' })
  if (s instanceof z.ZodEnum) return withDesc({ type: 'string', enum: def.values })
  if (s instanceof z.ZodArray) return withDesc({ type: 'array', items: convert(def.type) })
  return withDesc({})
}