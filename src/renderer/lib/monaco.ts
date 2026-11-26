import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json': return new jsonWorker()
      case 'css': case 'scss': case 'less': return new cssWorker()
      case 'html': case 'handlebars': case 'razor': return new htmlWorker()
      case 'typescript': case 'javascript': return new tsWorker()
      default: return new editorWorker()
    }
  }
}

monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false
})

monaco.editor.defineTheme('nexa-dark', {
  base: 'vs-dark',
  inherit: false,
  rules: [
    { token: '', foreground: 'F5F5F5' },
    { token: 'comment', foreground: '858585', fontStyle: 'italic' },
    { token: 'string', foreground: 'D4D4D4' },
    { token: 'keyword', foreground: 'FFFFFF', fontStyle: 'bold' },
    { token: 'number', foreground: 'E6E6E6' },
    { token: 'type', foreground: 'FFFFFF' },
    { token: 'identifier', foreground: 'E6E6E6' },
    { token: 'delimiter', foreground: 'B8B8B8' },
    { token: 'operator', foreground: 'C9C9C9' },
    { token: 'tag', foreground: 'FFFFFF' },
    { token: 'attribute.name', foreground: 'D4D4D4' },
    { token: 'attribute.value', foreground: 'B8B8B8' },
    { token: 'metatag', foreground: '858585' },
    { token: 'key', foreground: 'FFFFFF' },
    { token: 'annotation', foreground: '858585' },
    { token: 'regexp', foreground: 'D4D4D4' },
    { token: 'constant', foreground: 'FFFFFF' },
    { token: 'variable', foreground: 'E6E6E6' },
    { token: 'parameter', foreground: 'D4D4D4' },
    { token: 'function', foreground: 'FFFFFF' },
    { token: 'predefined', foreground: 'D4D4D4' },
    { token: 'namespace', foreground: 'D4D4D4' }
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#F5F5F5',
    'editorLineNumber.foreground': '#858585',
    'editorLineNumber.activeForeground': '#F5F5F5',
    'editorCursor.foreground': '#FFFFFF',
    'editor.selectionBackground': '#505050',
    'editor.inactiveSelectionBackground': '#383838',
    'editor.selectionHighlightBackground': '#383838',
    'editor.findMatchBackground': '#505050',
    'editor.findMatchHighlightBackground': '#383838',
    'editor.lineHighlightBackground': '#141414',
    'editor.lineHighlightBorder': '#242424',
    'editorIndentGuide.background': '#242424',
    'editorIndentGuide.activeBackground': '#505050',
    'editorWhitespace.foreground': '#383838',
    'editorBracketMatch.background': '#383838',
    'editorBracketMatch.border': '#858585',
    'editorBracketHighlight.foreground1': '#F5F5F5',
    'editorBracketHighlight.foreground2': '#D4D4D4',
    'editorBracketHighlight.foreground3': '#B8B8B8',
    'editorBracketHighlight.foreground4': '#E6E6E6',
    'editorBracketHighlight.foreground5': '#C9C9C9',
    'editorBracketHighlight.foreground6': '#858585',
    'editorBracketHighlight.unexpectedBracket.foreground': '#F5F5F5',
    'editorWidget.background': '#111111',
    'editorWidget.border': '#383838',
    'editorSuggestWidget.background': '#111111',
    'editorSuggestWidget.border': '#383838',
    'editorSuggestWidget.selectedBackground': '#383838',
    'editorHoverWidget.background': '#111111',
    'editorHoverWidget.border': '#383838',
    'quickInput.background': '#111111',
    'quickInput.foreground': '#F5F5F5',
    'quickInputList.focusBackground': '#383838',
    'quickInputList.focusForeground': '#FFFFFF',
    'focusBorder': '#858585',
    'input.background': '#000000',
    'input.foreground': '#F5F5F5',
    'input.border': '#383838',
    'list.activeSelectionBackground': '#383838',
    'list.activeSelectionForeground': '#FFFFFF',
    'list.hoverBackground': '#242424',
    'diffEditor.insertedTextBackground': '#303030',
    'diffEditor.removedTextBackground': '#1C1C1C',
    'scrollbarSlider.background': '#383838',
    'scrollbarSlider.hoverBackground': '#505050'
  }
})

monaco.editor.defineTheme('nexa-light', {
  base: 'vs',
  inherit: false,
  rules: [
    { token: '', foreground: '000000' },
    { token: 'comment', foreground: '6B6B6B', fontStyle: 'italic' },
    { token: 'string', foreground: '454545' },
    { token: 'keyword', foreground: '000000', fontStyle: 'bold' },
    { token: 'number', foreground: '1A1A1A' },
    { token: 'type', foreground: '000000' },
    { token: 'identifier', foreground: '1A1A1A' },
    { token: 'delimiter', foreground: '454545' },
    { token: 'operator', foreground: '333333' },
    { token: 'tag', foreground: '000000' },
    { token: 'attribute.name', foreground: '454545' },
    { token: 'attribute.value', foreground: '6B6B6B' },
    { token: 'metatag', foreground: '858585' },
    { token: 'key', foreground: '000000' },
    { token: 'annotation', foreground: '6B6B6B' },
    { token: 'regexp', foreground: '454545' },
    { token: 'constant', foreground: '000000' },
    { token: 'variable', foreground: '1A1A1A' },
    { token: 'parameter', foreground: '454545' },
    { token: 'function', foreground: '000000' },
    { token: 'predefined', foreground: '454545' },
    { token: 'namespace', foreground: '454545' }
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#000000',
    'editorLineNumber.foreground': '#6B6B6B',
    'editorLineNumber.activeForeground': '#000000',
    'editorCursor.foreground': '#000000',
    'editor.selectionBackground': '#D4D4D4',
    'editor.inactiveSelectionBackground': '#E6E6E6',
    'editor.selectionHighlightBackground': '#E6E6E6',
    'editor.findMatchBackground': '#D4D4D4',
    'editor.findMatchHighlightBackground': '#E6E6E6',
    'editor.lineHighlightBackground': '#F7F7F7',
    'editor.lineHighlightBorder': '#E6E6E6',
    'editorIndentGuide.background': '#E6E6E6',
    'editorIndentGuide.activeBackground': '#B8B8B8',
    'editorWhitespace.foreground': '#D4D4D4',
    'editorBracketMatch.background': '#E6E6E6',
    'editorBracketMatch.border': '#6B6B6B',
    'editorBracketHighlight.foreground1': '#000000',
    'editorBracketHighlight.foreground2': '#454545',
    'editorBracketHighlight.foreground3': '#6B6B6B',
    'editorBracketHighlight.foreground4': '#1A1A1A',
    'editorBracketHighlight.foreground5': '#333333',
    'editorBracketHighlight.foreground6': '#858585',
    'editorBracketHighlight.unexpectedBracket.foreground': '#000000',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#D4D4D4',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.border': '#D4D4D4',
    'editorSuggestWidget.selectedBackground': '#E6E6E6',
    'editorHoverWidget.background': '#FFFFFF',
    'editorHoverWidget.border': '#D4D4D4',
    'quickInput.background': '#FFFFFF',
    'quickInput.foreground': '#000000',
    'quickInputList.focusBackground': '#E6E6E6',
    'quickInputList.focusForeground': '#000000',
    'focusBorder': '#6B6B6B',
    'input.background': '#FFFFFF',
    'input.foreground': '#000000',
    'input.border': '#D4D4D4',
    'list.activeSelectionBackground': '#E6E6E6',
    'list.activeSelectionForeground': '#000000',
    'list.hoverBackground': '#F7F7F7',
    'diffEditor.insertedTextBackground': '#E8E8E8',
    'diffEditor.removedTextBackground': '#F7F7F7',
    'scrollbarSlider.background': '#D4D4D4',
    'scrollbarSlider.hoverBackground': '#B8B8B8'
  }
})

export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml', sh: 'shell', sql: 'sql'
  }
  return map[ext] ?? 'plaintext'
}

export { monaco }
