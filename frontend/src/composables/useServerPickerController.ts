import { ref } from 'vue'

export function useServerPickerController() {
  const isOpen = ref(false)
  const anchor = ref<HTMLElement | null>(null)
  const canonicalAnchor = ref<HTMLElement | null>(null)

  function setAnchorFromElement(element: HTMLElement | null) {
    anchor.value = element
  }

  function clearAnchor() {
    anchor.value = null
    canonicalAnchor.value = null
  }

  function close() {
    isOpen.value = false
  }

  function resolveCanonicalAnchor() {
    if (canonicalAnchor.value && document.documentElement.contains(canonicalAnchor.value)) {
      return canonicalAnchor.value
    }
    const topbarAnchor = document.querySelector<HTMLElement>('.topbar-add')
    if (topbarAnchor) {
      canonicalAnchor.value = topbarAnchor
      return topbarAnchor
    }
    return anchor.value
  }

  function openFromTopbar(element: HTMLElement) {
    anchor.value = element
    canonicalAnchor.value = element
    isOpen.value = true
  }

  function toggleFromTopbar(element: HTMLElement) {
    anchor.value = element
    canonicalAnchor.value = element
    isOpen.value = !isOpen.value
  }

  function openForPaneTarget() {
    anchor.value = resolveCanonicalAnchor()
    isOpen.value = true
  }

  return {
    isOpen,
    anchor,
    canonicalAnchor,
    openFromTopbar,
    toggleFromTopbar,
    openForPaneTarget,
    close,
    resolveCanonicalAnchor,
    setAnchorFromElement,
    clearAnchor,
  }
}
