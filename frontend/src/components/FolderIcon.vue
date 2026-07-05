<template>
  <svg class="folder-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path class="folder-icon-tab" d="M1.6 4.7c0-.9.7-1.6 1.6-1.6h3l1.2 1.2h5.4c.9 0 1.6.7 1.6 1.6v.6H1.6z" />
    <path class="folder-icon-body" d="M1.4 5.7h13.2v5.9c0 .9-.7 1.6-1.6 1.6H3c-.9 0-1.6-.7-1.6-1.6z" />
    <path class="folder-icon-highlight" d="M2.3 6.5h11.4v1.2H2.3z" />
    <path class="folder-icon-edge" d="M2.3 12.2h11.4c-.2.4-.6.7-1.1.7H3.4c-.5 0-.9-.3-1.1-.7z" />
  </svg>
</template>

<style scoped>
.folder-icon {
  width: 16px;
  height: 16px;
  display: block;
  filter: drop-shadow(0 0 5px rgba(59, 130, 246, .24));
}

.folder-icon-tab {
  fill: color-mix(in srgb, currentColor 78%, white 22%);
}

.folder-icon-body {
  fill: currentColor;
}

.folder-icon-highlight {
  fill: #fff;
  opacity: .42;
}

.folder-icon-edge {
  fill: color-mix(in srgb, currentColor 72%, #1e3a8a 28%);
  opacity: .72;
}
</style>
