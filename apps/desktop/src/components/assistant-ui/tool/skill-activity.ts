import { translateNow } from '@/i18n'
import { firstStringField } from '@/lib/text'
import { extractToolErrorMessage } from '@/lib/tool-result-summary'

import { parseMaybeObject } from './fallback-model/format'

interface SkillCall {
  args?: unknown
  completedAt?: number
  isError?: boolean
  result?: unknown
  toolName: string
}

interface SkillManageOp {
  action?: string
  name?: string
  file_path?: string
}

/** The advertised skill_manage schema is a batch `operations` array; older and
 * direct calls carry one flat action. Read both shapes the same way. */
function skillManageOps(args: Record<string, unknown>): SkillManageOp[] {
  const raw = Array.isArray(args.operations) ? args.operations : null

  if (raw && raw.length > 0) {
    return raw.filter(op => op && typeof op === 'object') as SkillManageOp[]
  }

  const action = typeof args.action === 'string' ? args.action : undefined
  const name = typeof args.name === 'string' ? args.name : undefined

  return action || name
    ? [{ action, name, file_path: typeof args.file_path === 'string' ? args.file_path : undefined }]
    : []
}

/** Loading instructions is not the same action as reading a skill resource,
 * and neither proves the task described by the skill has been completed. */
export function skillActivityTitle(part: SkillCall, live = true): string | undefined {
  if (part.toolName !== 'skill_view' && part.toolName !== 'skills_list' && part.toolName !== 'skill_manage') {
    return undefined
  }

  const args = parseMaybeObject(part.args)
  const result = parseMaybeObject(part.result)

  if (part.toolName === 'skill_manage') {
    const ops = skillManageOps(args)

    if (ops.length === 0) {
      return undefined
    }

    const failed =
      result.success !== true &&
      result.ok !== true &&
      Boolean(part.isError || extractToolErrorMessage(part.result) || result.success === false || result.ok === false)

    const pending = live && part.result === undefined && part.completedAt === undefined
    const actions = ops.map(op => op.action).filter((a): a is string => Boolean(a))

    const doneKey =
      actions.length > 0 && actions.every(a => a === 'create')
        ? 'created'
        : actions.length > 0 && actions.every(a => a === 'delete')
          ? 'deleted'
          : 'managed'

    const key = failed ? 'manageFailed' : pending ? 'managing' : doneKey
    const label = translateNow(`assistant.tool.skillActivity.${key}`)

    const first = ops[0]
    const target = [first.name, first.file_path].filter(Boolean).join(' → ')
    const suffix = ops.length > 1 ? ` +${ops.length - 1}` : ''

    return target ? `${label}: ${target}${suffix}` : label
  }

  const failed =
    result.success !== true &&
    result.ok !== true &&
    Boolean(part.isError || extractToolErrorMessage(part.result) || result.success === false || result.ok === false)

  const pending = live && part.result === undefined && part.completedAt === undefined
  const missing = !pending && part.result === undefined
  const file = firstStringField(args, ['file_path'])
  const name = firstStringField(args, ['name'])
  const target = [name, file].filter(Boolean).join(' → ')

  const keys =
    part.toolName === 'skills_list'
      ? { pending: 'listing', done: 'listed', failed: 'listFailed' }
      : file
        ? { pending: 'readingResource', done: 'readResource', failed: 'resourceFailed' }
        : { pending: 'loading', done: 'loaded', failed: 'loadFailed' }

  const key = failed ? keys.failed : missing ? 'unavailable' : pending ? keys.pending : keys.done
  const label = translateNow(`assistant.tool.skillActivity.${key}`)

  return target ? `${label}: ${target}` : label
}
