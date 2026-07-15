/**
 * test/mocks/vscode.ts
 *
 * A minimal in-memory stand-in for the `vscode` module, aliased in
 * vitest.config.ts. It implements just the API surface the extension uses
 * and exposes `__mock` so tests can fire events and inspect side effects.
 */

type Listener<T> = (event: T) => void

export interface Disposable {
  dispose(): void
}

class MockEmitter<T> {
  readonly listeners = new Set<Listener<T>>()

  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener)
    return { dispose: () => void this.listeners.delete(listener) }
  }

  fire(event: T): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string
  ) {}

  static file(path: string): Uri {
    return new Uri('file', path)
  }

  toString(): string {
    return `${this.scheme}://${this.fsPath}`
  }
}

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2
} as const

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15
} as const

export class MockWebviewPanel {
  readonly webview: {
    html: string
    options: unknown
    cspSource: string
    asWebviewUri: (uri: Uri) => { toString(): string }
  }

  readonly onDidDisposeEmitter = new MockEmitter<void>()
  disposed = false
  revealCalls: unknown[] = []

  constructor(
    readonly viewType: string,
    public title: string,
    readonly column: unknown,
    options: unknown
  ) {
    this.webview = {
      html: '',
      options,
      cspSource: 'mock-csp-source',
      asWebviewUri: (uri: Uri) => ({
        toString: () => `vscode-webview://mock${uri.fsPath}`
      })
    }
  }

  readonly onDidDispose = (listener: Listener<void>): Disposable =>
    this.onDidDisposeEmitter.event(listener)

  reveal(column: unknown): void {
    this.revealCalls.push(column)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onDidDisposeEmitter.fire()
  }
}

export interface MockOutputChannel {
  name: string
  lines: string[]
  appendLine(line: string): void
  show(): void
  dispose(): void
}

function createMockOutputChannel(name: string): MockOutputChannel {
  return {
    name,
    lines: [],
    appendLine(line: string) {
      this.lines.push(line)
    },
    show() {},
    dispose() {}
  }
}

export const __mock = {
  panels: [] as MockWebviewPanel[],
  messages: [] as string[],
  errorMessages: [] as Array<{ message: string; items: string[] }>,
  outputChannels: [] as MockOutputChannel[],
  contextValues: new Map<string, unknown>(),
  registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
  executedCommands: [] as unknown[][],
  changeTextDocument: new MockEmitter<{ document: unknown }>(),
  closeTextDocument: new MockEmitter<unknown>(),
  changeActiveTextEditor: new MockEmitter<unknown>(),
  activeTextEditor: undefined as unknown,
  workspaceFolders: undefined as unknown,
  configuration: new Map<string, unknown>(),
  saveDialogCalls: [] as unknown[],
  saveDialogResult: undefined as Uri | undefined,
  progressCalls: [] as unknown[],
  infoMessageChoice: undefined as string | undefined,
  errorMessageChoice: undefined as string | undefined,
  openedExternal: [] as Uri[],

  reset(): void {
    this.panels = []
    this.messages = []
    this.errorMessages = []
    this.outputChannels = []
    this.contextValues.clear()
    this.registeredCommands.clear()
    this.executedCommands = []
    this.changeTextDocument.listeners.clear()
    this.closeTextDocument.listeners.clear()
    this.changeActiveTextEditor.listeners.clear()
    this.activeTextEditor = undefined
    this.workspaceFolders = undefined
    this.configuration.clear()
    this.saveDialogCalls = []
    this.saveDialogResult = undefined
    this.progressCalls = []
    this.infoMessageChoice = undefined
    this.errorMessageChoice = undefined
    this.openedExternal = []
  }
}

export const window = {
  get activeTextEditor() {
    return __mock.activeTextEditor
  },
  createWebviewPanel(
    viewType: string,
    title: string,
    column: unknown,
    options: unknown
  ): MockWebviewPanel {
    const panel = new MockWebviewPanel(viewType, title, column, options)
    __mock.panels.push(panel)
    return panel
  },
  showInformationMessage(message: string): Promise<string | undefined> {
    __mock.messages.push(message)
    return Promise.resolve(__mock.infoMessageChoice)
  },
  showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    __mock.errorMessages.push({ message, items })
    return Promise.resolve(__mock.errorMessageChoice)
  },
  showSaveDialog(options: unknown): Promise<Uri | undefined> {
    __mock.saveDialogCalls.push(options)
    return Promise.resolve(__mock.saveDialogResult)
  },
  withProgress<T>(options: unknown, task: () => Promise<T>): Promise<T> {
    __mock.progressCalls.push(options)
    return Promise.resolve(task())
  },
  createOutputChannel(name: string): MockOutputChannel {
    const channel = createMockOutputChannel(name)
    __mock.outputChannels.push(channel)
    return channel
  },
  onDidChangeActiveTextEditor: (listener: Listener<unknown>) =>
    __mock.changeActiveTextEditor.event(listener)
}

export const env = {
  openExternal(uri: Uri): Promise<boolean> {
    __mock.openedExternal.push(uri)
    return Promise.resolve(true)
  }
}

export const workspace = {
  get workspaceFolders() {
    return __mock.workspaceFolders
  },
  onDidChangeTextDocument: (listener: Listener<{ document: unknown }>) =>
    __mock.changeTextDocument.event(listener),
  onDidCloseTextDocument: (listener: Listener<unknown>) =>
    __mock.closeTextDocument.event(listener),
  getConfiguration(section: string) {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const qualified = `${section}.${key}`
        if (__mock.configuration.has(qualified)) {
          return __mock.configuration.get(qualified) as T
        }
        return defaultValue
      }
    }
  }
}

export const commands = {
  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): Disposable {
    __mock.registeredCommands.set(id, handler)
    return { dispose: () => void __mock.registeredCommands.delete(id) }
  },
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    __mock.executedCommands.push([id, ...args])
    if (id === 'setContext') {
      __mock.contextValues.set(String(args[0]), args[1])
      return Promise.resolve(undefined)
    }
    const handler = __mock.registeredCommands.get(id)
    return Promise.resolve(handler ? handler(...args) : undefined)
  }
}
