// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { useServerPickerController } from './useServerPickerController'

function button(className = '') {
  const element = document.createElement('button')
  element.className = className
  document.body.append(element)
  return element
}

describe('useServerPickerController', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('topbar open records the canonical anchor and opens the picker', () => {
    const controller = useServerPickerController()
    const anchor = button('topbar-add')

    controller.openFromTopbar(anchor)

    expect(controller.isOpen.value).toBe(true)
    expect(controller.anchor.value).toBe(anchor)
    expect(controller.resolveCanonicalAnchor()).toBe(anchor)
  })

  it('topbar toggle preserves the existing plus-button toggle behavior', () => {
    const controller = useServerPickerController()
    const anchor = button('topbar-add')

    controller.toggleFromTopbar(anchor)
    expect(controller.isOpen.value).toBe(true)

    controller.toggleFromTopbar(anchor)
    expect(controller.isOpen.value).toBe(false)
    expect(controller.anchor.value).toBe(anchor)
  })

  it('pane-targeted open reuses the canonical topbar placement', () => {
    const controller = useServerPickerController()
    const topbar = button('topbar-add')
    const paneButton = button()

    controller.setAnchorFromElement(paneButton)
    controller.openFromTopbar(topbar)
    controller.close()
    controller.openForPaneTarget()

    expect(controller.isOpen.value).toBe(true)
    expect(controller.anchor.value).toBe(topbar)
  })

  it('falls back to the live topbar anchor or current anchor when canonical anchor is stale', () => {
    const stale = button('topbar-add')
    const current = button()
    const controller = useServerPickerController()
    controller.openFromTopbar(stale)
    stale.remove()
    controller.setAnchorFromElement(current)

    expect(controller.resolveCanonicalAnchor()).toBe(current)

    const replacement = button('topbar-add')
    expect(controller.resolveCanonicalAnchor()).toBe(replacement)
    expect(controller.anchor.value).toBe(current)
  })

  it('close clears only picker open state and keeps anchor state for focus restore', () => {
    const controller = useServerPickerController()
    const anchor = button('topbar-add')
    controller.openFromTopbar(anchor)

    controller.close()

    expect(controller.isOpen.value).toBe(false)
    expect(controller.anchor.value).toBe(anchor)
  })
})
