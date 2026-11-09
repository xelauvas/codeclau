import { spawn } from 'child_process'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const PUSH_NOTIFICATION_TOOL_NAME = 'PushNotification'

const PROMPT = `Send a desktop notification to the user, for moments they would want to be interrupted for: a long task finished, a decision is needed, something broke. Keep the title under 50 characters and the body to one or two sentences. Do not use it for routine progress; the transcript already shows that.`

const inputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string().max(120).describe('Notification title'),
    body: z.string().max(1000).optional().describe('Notification body'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({ channels: z.array(z.string()), message: z.string() }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

function run(cmd: string, args: string[], timeoutMs = 4000): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore' })
      const t = setTimeout(() => {
        child.kill()
        resolve(false)
      }, timeoutMs)
      child.on('error', () => {
        clearTimeout(t)
        resolve(false)
      })
      child.on('exit', code => {
        clearTimeout(t)
        resolve(code === 0)
      })
    } catch {
      resolve(false)
    }
  })
}

function isWsl(): boolean {
  return !!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP
}

/**
 * Best effort across environments: terminal notification escape (OSC 9 /
 * OSC 777, understood by Windows Terminal, iTerm2, kitty, WezTerm...), then a
 * native notifier when one exists. Returns the channels that accepted it.
 */
export async function sendDesktopNotification(title: string, body: string): Promise<string[]> {
  const channels: string[] = []
  if (process.stdout.isTTY) {
    const text = body ? `${title}: ${body}` : title
    process.stdout.write(`\u001b]9;${text}\u0007`)
    process.stdout.write(`\u001b]777;notify;${title};${body}\u0007`)
    process.stdout.write('\u0007')
    channels.push('terminal')
  }
  if (process.platform === 'darwin') {
    const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`
    if (await run('osascript', ['-e', script])) channels.push('macos')
  } else if (process.platform === 'linux') {
    if (isWsl()) {
      const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $n=$t.GetElementsByTagName('text'); $n.Item(0).AppendChild($t.CreateTextNode(${JSON.stringify(title)})) | Out-Null; $n.Item(1).AppendChild($t.CreateTextNode(${JSON.stringify(body)})) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Xela').Show([Windows.UI.Notifications.ToastNotification]::new($t))`
      if (await run('powershell.exe', ['-NoProfile', '-Command', ps], 8000)) channels.push('windows-toast')
    }
    if (await run('notify-send', [title, body])) channels.push('notify-send')
  }
  return channels
}

export const PushNotificationTool = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint: 'desktop notification to the user',
  maxResultSizeChars: 500,
  userFacingName: () => 'Notify',
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  async description({ title }) {
    return `Notify: ${title}`
  },
  async prompt() {
    return PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: output.message }
  },
  renderToolUseMessage(input: { title?: string }) {
    return input.title ?? ''
  },
  renderToolResultMessage(output: Output) {
    return output.channels.length ? `sent via ${output.channels.join(', ')}` : 'no notification channel available'
  },
  async call({ title, body }) {
    const channels = await sendDesktopNotification(title, body ?? '')
    const message = channels.length
      ? `Notification sent (${channels.join(', ')}).`
      : 'No notification channel was available; the user will only see this transcript.'
    return { data: { channels, message } }
  },
})
