// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SftpDetailsPane, { type SftpDetailsRow } from './SftpDetailsPane.vue'

const fileRows: SftpDetailsRow[] = [
  { label: '名称', value: 'install.sh', title: 'install.sh' },
  { label: '类型', value: '文件' },
  { label: '大小', value: '128 B' },
  { label: '权限', value: '-rwxr-xr-x' },
  { label: '所有者', value: 'root' },
  { label: '用户组', value: 'wheel' },
  { label: '修改时间', value: '2026-06-16 08:00:00' },
  { label: '隐藏文件', value: '否' },
  { label: '符号链接', value: '否' },
  { label: '权限原文', value: '-rwxr-xr-x', code: true },
  { label: '远程路径', value: '/root/scripts/install.sh', title: '/root/scripts/install.sh' },
]

function mountDetails(options: {
  collapsed?: boolean
  selectedCount?: number
  selectedSizeText?: string
  detailRows?: SftpDetailsRow[]
} = {}) {
  return mount(SftpDetailsPane, {
    props: {
      collapsed: options.collapsed ?? false,
      selectedCount: options.selectedCount ?? 1,
      selectedSizeText: options.selectedSizeText ?? '128 B',
      detailRows: options.detailRows ?? fileRows,
    },
  })
}

describe('SftpDetailsPane', () => {
  it('renders empty, multi-selection, and single-entry details with existing classes', async () => {
    const wrapper = mountDetails({ selectedCount: 0, detailRows: [] })

    expect(wrapper.get('.sftp-details').attributes('data-ui-no-text-select')).toBeUndefined()
    expect(wrapper.get('.sftp-detail-empty').text()).toBe('未选择文件')

    await wrapper.setProps({ selectedCount: 2, selectedSizeText: '300 B', detailRows: [] })
    expect(wrapper.get('.sftp-detail-grid').text()).toContain('已选择 2 项')
    expect(wrapper.get('.sftp-detail-grid').text()).toContain('300 B')

    await wrapper.setProps({ selectedCount: 1, detailRows: fileRows })
    const labels = wrapper.findAll('.sftp-detail-grid span').map((item) => item.text())
    expect(labels).toEqual(fileRows.map((row) => row.label))
    expect(wrapper.get('.sftp-detail-grid').text()).toContain('install.sh')
    expect(wrapper.get('.sftp-detail-grid').text()).toContain('/root/scripts/install.sh')
    expect(wrapper.get('.sftp-detail-grid code').text()).toBe('-rwxr-xr-x')
  })

  it('renders collapsed state and emits expand/collapse and resize-start events', async () => {
    const wrapper = mountDetails({ collapsed: true })

    expect(wrapper.find('.sftp-details').exists()).toBe(false)
    expect(wrapper.get('.sftp-details-expand').text()).toBe('详情')

    await wrapper.get('.sftp-details-expand').trigger('click')
    expect(wrapper.emitted('toggleCollapsed')).toHaveLength(1)

    await wrapper.setProps({ collapsed: false })
    await wrapper.get('.sftp-details header .text-button').trigger('click')
    wrapper.get('.sftp-details-resizer').element
      .dispatchEvent(new MouseEvent('pointerdown', { clientX: 720, bubbles: true }))

    expect(wrapper.emitted('toggleCollapsed')).toHaveLength(2)
    expect(wrapper.emitted('resizeStart')).toHaveLength(1)
    expect(wrapper.emitted('resizeStart')?.[0][0]).toBeInstanceOf(MouseEvent)
  })
})
