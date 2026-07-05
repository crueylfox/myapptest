import { describe, expect, it } from 'vitest'
import { useSftpPathNavigation } from './useSftpPathNavigation'

describe('useSftpPathNavigation', () => {
  it('tracks successful direct navigation and ignores duplicate paths', () => {
    const navigation = useSftpPathNavigation()

    navigation.navigationFor('ctx-1', 7, '/home')
    navigation.recordSuccessfulNavigation('ctx-1', 7, '/home', '/var/log')
    navigation.recordSuccessfulNavigation('ctx-1', 7, '/var/log', '/var/log/')

    expect(navigation.navigationFor('ctx-1', 7, '/var/log').backStack).toEqual(['/home'])
    expect(navigation.navigationFor('ctx-1', 7, '/var/log').forwardStack).toEqual([])
  })

  it('moves current paths through back and forward stacks', () => {
    const navigation = useSftpPathNavigation()
    navigation.recordSuccessfulNavigation('ctx-1', 7, '/', '/var')
    navigation.recordSuccessfulNavigation('ctx-1', 7, '/var', '/home')

    const beforeBack = navigation.navigationFor('ctx-1', 7, '/home')
    navigation.applyBackNavigation('ctx-1', 7, beforeBack, '/home', '/var')
    expect(navigation.navigationFor('ctx-1', 7, '/var')).toEqual({
      backStack: ['/'],
      forwardStack: ['/home'],
      currentPath: '/var',
    })

    const beforeForward = navigation.navigationFor('ctx-1', 7, '/var')
    navigation.applyForwardNavigation('ctx-1', 7, beforeForward, '/var', '/home')
    expect(navigation.navigationFor('ctx-1', 7, '/home')).toEqual({
      backStack: ['/', '/var'],
      forwardStack: [],
      currentPath: '/home',
    })
  })

  it('does not mutate history for refresh, reconnect, or failed navigation', () => {
    const navigation = useSftpPathNavigation()
    navigation.navigationFor('ctx-1', 7, '/home')
    const before = navigation.navigationFor('ctx-1', 7, '/home')

    navigation.navigationFor('ctx-1', 7, '/home')

    expect(navigation.navigationFor('ctx-1', 7, '/home')).toEqual(before)
  })

  it('clamps history stacks and reports invalid control-character paths', () => {
    const navigation = useSftpPathNavigation({ historyLimit: 3 })
    for (let index = 0; index < 5; index++) {
      navigation.recordSuccessfulNavigation('ctx-1', 7, `/p${index}`, `/p${index + 1}`)
    }

    expect(navigation.navigationFor('ctx-1', 7, '/p5').backStack).toEqual(['/p2', '/p3', '/p4'])
    expect(navigation.isValidPath('/ok/path')).toBe(true)
    expect(navigation.isValidPath('/bad\u0000path')).toBe(false)
    expect(navigation.isValidPath('/bad\rpath')).toBe(false)
    expect(navigation.isValidPath('/bad\npath')).toBe(false)
  })
})
