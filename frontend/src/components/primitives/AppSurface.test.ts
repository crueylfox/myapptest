// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

// @ts-expect-error The app tsconfig intentionally omits Node globals; this test reads local component source.
const { readFileSync } = await import('node:fs') as { readFileSync: (path: string, encoding: string) => string }

import AppActionBar from './AppActionBar.vue'
import AppBackdrop from './AppBackdrop.vue'
import AppPopover from './AppPopover.vue'
import AppSurface from './AppSurface.vue'
import AppToolbar from './AppToolbar.vue'

describe('UI surface primitives', () => {
  it('renders modal surfaces through canonical surface and material classes while preserving native element attrs', () => {
    const wrapper = mount(AppSurface, {
      props: {
        as: 'form',
        variant: 'modal',
      },
      attrs: {
        id: 'confirm-dialog',
        'aria-label': 'Confirm',
      },
      slots: {
        default: '<button type="submit">OK</button>',
      },
    })

    expect(wrapper.element.tagName).toBe('FORM')
    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'app-surface',
      'app-surface--modal',
      'app-material-surface',
    ]))
    expect(wrapper.attributes('id')).toBe('confirm-dialog')
    expect(wrapper.attributes('aria-label')).toBe('Confirm')
    expect(wrapper.find('button[type="submit"]').text()).toBe('OK')
  })

  it('maps panel, card, toolbar, actionbar, control, and popover variants to one canonical primitive', () => {
    const variants = [
      ['panel', 'app-material-panel'],
      ['card', 'app-material-card'],
      ['toolbar', 'app-material-toolbar'],
      ['actionbar', 'app-material-toolbar'],
      ['control', 'app-surface--control'],
      ['popover', 'app-surface--popover'],
    ] as const

    for (const [variant, expectedClass] of variants) {
      const wrapper = mount(AppSurface, {
        props: {
          variant,
        },
      })
      expect(wrapper.classes()).toContain(`app-surface--${variant}`)
      expect(wrapper.classes()).toContain(expectedClass)
    }
  })

  it('can opt a surface into the future Liquid Glass material without changing the default material', () => {
    const standard = mount(AppSurface, {
      props: {
        variant: 'modal',
      },
    })
    const liquid = mount(AppSurface, {
      props: {
        variant: 'modal',
        material: 'liquid',
      },
    })

    expect(standard.classes()).not.toContain('app-surface--liquid')
    expect(liquid.classes()).toEqual(expect.arrayContaining([
      'app-surface',
      'app-surface--modal',
      'app-surface--liquid',
      'app-material-surface',
    ]))
  })

  it('renders backdrops as the single canonical backdrop primitive and preserves event fallthrough', async () => {
    let pointerCount = 0
    const wrapper = mount(AppBackdrop, {
      props: {
        kind: 'modal',
        danger: true,
      },
      attrs: {
        class: 'modal-backdrop app-dialog-backdrop',
        onPointerdown: () => { pointerCount += 1 },
      },
      slots: {
        default: '<section class="content">Dialog</section>',
      },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'app-backdrop',
      'app-backdrop--modal',
      'app-material-backdrop',
      'modal-backdrop',
      'app-dialog-backdrop',
      'danger-modal',
    ]))
    expect(wrapper.text()).toContain('Dialog')
    await wrapper.trigger('pointerdown')
    expect(pointerCount).toBe(1)
  })

  it('renders viewport popovers through the canonical surface primitive while preserving attrs and events', async () => {
    let contextMenuCount = 0
    const wrapper = mount(AppPopover, {
      attrs: {
        class: 'context-menu',
        role: 'menu',
        tabindex: '-1',
        style: 'left: 12px; top: 18px;',
        onContextmenu: (event: Event) => {
          event.preventDefault()
          contextMenuCount += 1
        },
      },
      slots: {
        default: '<button type="button">Open</button>',
      },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'app-popover',
      'app-surface',
      'app-surface--popover',
      'app-material-card',
      'viewport-popover',
      'viewport-popover-menu',
      'viewport-popover-scroll',
      'context-menu',
    ]))
    expect(wrapper.attributes('role')).toBe('menu')
    expect(wrapper.attributes('tabindex')).toBe('-1')
    expect(wrapper.find('button').text()).toBe('Open')

    await wrapper.trigger('contextmenu')
    expect(contextMenuCount).toBe(1)
  })

  it('renders toolbars through the canonical surface primitive with toolbar semantics and attr fallthrough', () => {
    const wrapper = mount(AppToolbar, {
      props: {
        as: 'nav',
      },
      attrs: {
        id: 'primary-toolbar',
        'aria-label': 'Primary actions',
        class: 'hostdeck-toolbar',
      },
      slots: {
        default: '<button type="button">Refresh</button>',
      },
    })

    expect(wrapper.element.tagName).toBe('NAV')
    expect(wrapper.attributes('role')).toBe('toolbar')
    expect(wrapper.attributes('id')).toBe('primary-toolbar')
    expect(wrapper.attributes('aria-label')).toBe('Primary actions')
    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'app-toolbar',
      'app-surface',
      'app-surface--toolbar',
      'app-material-toolbar',
      'hostdeck-toolbar',
    ]))
    expect(wrapper.find('button').text()).toBe('Refresh')
  })

  it('renders action bars through the canonical surface primitive with group semantics and attr fallthrough', () => {
    const wrapper = mount(AppActionBar, {
      props: {
        as: 'footer',
      },
      attrs: {
        id: 'dialog-actions',
        'aria-label': 'Dialog actions',
        class: 'hostdeck-actions',
      },
      slots: {
        default: '<button type="button">Apply</button>',
      },
    })

    expect(wrapper.element.tagName).toBe('FOOTER')
    expect(wrapper.attributes('role')).toBe('group')
    expect(wrapper.attributes('id')).toBe('dialog-actions')
    expect(wrapper.attributes('aria-label')).toBe('Dialog actions')
    expect(wrapper.classes()).toEqual(expect.arrayContaining([
      'app-action-bar',
      'app-surface',
      'app-surface--actionbar',
      'app-material-toolbar',
      'hostdeck-actions',
    ]))
    expect(wrapper.find('button').text()).toBe('Apply')
  })

  it('migrates AppDialogHost to primitives without removing existing public selector classes', () => {
    const source = readFileSync('src/components/AppDialogHost.vue', 'utf8')
    expect(source).toContain("import AppBackdrop from './primitives/AppBackdrop.vue'")
    expect(source).toContain("import AppSurface from './primitives/AppSurface.vue'")
    expect(source).toContain('<AppBackdrop')
    expect(source).toContain('class="modal-backdrop app-dialog-backdrop"')
    expect(source).toContain('<AppSurface')
    expect(source).toContain('class="modal app-dialog"')
  })

  it('migrates Settings overlay backdrop to the backdrop primitive without changing its public selector', () => {
    const source = readFileSync('src/components/AppOverlayHost.vue', 'utf8')
    expect(source).toContain("import AppBackdrop from './primitives/AppBackdrop.vue'")
    expect(source).toContain('<AppBackdrop')
    expect(source).toContain('kind="popover"')
    expect(source).toContain('class="settings-overlay-backdrop"')
    expect(source).not.toContain('class="settings-overlay-backdrop app-material-backdrop"')
  })

  it('migrates ContextMenu to AppPopover without changing its public selector classes', () => {
    const source = readFileSync('src/components/ContextMenu.vue', 'utf8')
    expect(source).toContain("import AppPopover from './primitives/AppPopover.vue'")
    expect(source).toContain('<AppPopover')
    expect(source).toContain('class="context-menu"')
    expect(source).not.toContain('class="viewport-popover viewport-popover-menu viewport-popover-scroll context-menu"')
  })

  it('migrates the topbar navigation menu to AppPopover without changing menu item markup', () => {
    const source = readFileSync('src/components/WorkspaceTabs.vue', 'utf8')
    expect(source).toContain("import AppPopover from './primitives/AppPopover.vue'")
    expect(source).toContain('<AppPopover v-if="navigationOpen" :viewport="false" class="topbar-menu">')
    expect(source).toContain('</AppPopover>')
    expect(source).not.toContain('<div v-if="navigationOpen" class="topbar-menu">')
    expect(source).toContain('class="topbar-menu-item active"')
    expect(source).toContain('class="topbar-menu-item topbar-menu-badge-row"')
  })

  it('moves split mode controls into the global AppPopover menu', () => {
    const source = readFileSync('src/components/WorkspaceTabs.vue', 'utf8')
    expect(source).toContain("import AppPopover from './primitives/AppPopover.vue'")
    expect(source).toContain('<AppPopover v-if="navigationOpen" :viewport="false" class="topbar-menu">')
    expect(source).toContain('data-split-menu-toggle')
    expect(source).not.toContain('<div v-if="splitMenuOpen" class="split-mode-menu">')
    expect(source).not.toContain('class="topbar-split"')
    expect(source).toContain('data-split-mode="single"')
    expect(source).toContain('data-split-mode="quad"')
    expect(source).toContain('@click="resetTopbarSplitRatios"')
    expect(source).toContain('@click="clearTopbarSplitPanes"')
  })

  it('routes manager filter toolbars through AppToolbar without changing public selector classes', () => {
    const migrations = [
      {
        path: 'src/components/ProcessManagerDialog.vue',
        importPath: './primitives/AppToolbar.vue',
        migratedTag: '<AppToolbar v-else class="process-toolbar">',
        legacyTag: '<div v-else class="process-toolbar">',
      },
      {
        path: 'src/components/ServiceManagerDialog.vue',
        importPath: './primitives/AppToolbar.vue',
        migratedTag: '<AppToolbar class="service-filter-toolbar">',
        legacyTag: '<div class="service-filter-toolbar">',
      },
      {
        path: 'src/components/NetworkDiagnosticsDialog.vue',
        importPath: './primitives/AppToolbar.vue',
        migratedTag: '<AppToolbar class="network-diagnostics-toolbar">',
        legacyTag: '<div class="network-diagnostics-toolbar">',
      },
    ]

    for (const migration of migrations) {
      const source = readFileSync(migration.path, 'utf8')
      expect(source).toContain(`import AppToolbar from '${migration.importPath}'`)
      expect(source).toContain(migration.migratedTag)
      expect(source).not.toContain(migration.legacyTag)
    }
  })

  it('routes stable footer action areas through AppActionBar without changing public selector classes', () => {
    const migrations = [
      {
        path: 'src/components/RemoteFilePropertiesDialog.vue',
        importPath: './primitives/AppActionBar.vue',
        migratedTag: '<AppActionBar as="footer" class="remote-properties-actions">',
        legacyTag: '<footer class="remote-properties-actions">',
      },
      {
        path: 'src/components/TerminalWorkspace.vue',
        importPath: './primitives/AppActionBar.vue',
        migratedTag: '<AppActionBar as="footer" class="transfer-popover-actions">',
        legacyTag: '<footer class="transfer-popover-actions">',
      },
    ]

    for (const migration of migrations) {
      const source = readFileSync(migration.path, 'utf8')
      expect(source).toContain(`import AppActionBar from '${migration.importPath}'`)
      expect(source).toContain(migration.migratedTag)
      expect(source).not.toContain(migration.legacyTag)
    }
  })
})
