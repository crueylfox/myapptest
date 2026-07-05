import { Prec, type Extension } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'

const visibleSelectionMark = Decoration.mark({
  class: 'sp-visible-selection',
  attributes: {
    'data-sp-visible-selection': 'true',
  },
})

function buildVisibleSelectionDecorations(view: EditorView): DecorationSet {
  const ranges = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => visibleSelectionMark.range(range.from, range.to))

  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
}

const visibleSelectionPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildVisibleSelectionDecorations(view)
  }

  update(update: ViewUpdate) {
    if (!update.selectionSet && !update.docChanged) return
    this.decorations = buildVisibleSelectionDecorations(update.view)
  }
}, {
  decorations: (plugin) => plugin.decorations,
})

export const visibleSelectionDecoration: Extension = Prec.highest(visibleSelectionPlugin)
