import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import SettingsReminders from '../../src/renderer/src/components/SettingsReminders'
import { useAction } from '../../src/renderer/src/hooks/useAction'
import { defaultSettings } from '../../src/shared/schema'
import type { AutostartInfo } from '../../src/shared/views'
import { installButler } from './butlerMock'

// 和真实的设置页一样用 useAction，再把出错信息显示出来，方便断言
function Harness({ autostart }: { autostart: AutostartInfo }) {
  const act = useAction()
  return (
    <>
      <p role="alert">{act.error}</p>
      <SettingsReminders reminders={defaultSettings().reminders} autostart={autostart} act={act} />
    </>
  )
}

const BOX = /开机后自动启动/

describe('设置：提醒', () => {
  it('默认没开、没设时间', () => {
    installButler({})
    render(<Harness autostart={{ supported: true, enabled: false }} />)
    expect((screen.getByLabelText('开启提醒') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('今天还没排计划时，提醒的时间') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('今天还没复盘时，提醒的时间') as HTMLInputElement).value).toBe('')
  })

  it('打开提醒、只设复盘的时间：保存成 enabled + 复盘时间，计划那项是 null', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'settings:update': undefined })
    render(<Harness autostart={{ supported: true, enabled: false }} />)
    await user.click(screen.getByLabelText('开启提醒'))
    fireEvent.change(screen.getByLabelText('今天还没复盘时，提醒的时间'), { target: { value: '22:00' } })
    await user.click(screen.getByRole('button', { name: '保存提醒' }))
    expect(butler.callsOf('settings:update')).toEqual([{ reminders: { enabled: true, plan: null, review: '22:00' } }])
  })
})

describe('设置：开机自启', () => {
  it('支持时：勾上就设置，勾选状态以主进程返回的为准', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'autostart:set': ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }) })
    render(<Harness autostart={{ supported: true, enabled: false }} />)
    expect((screen.getByLabelText(BOX) as HTMLInputElement).checked).toBe(false)
    await user.click(screen.getByLabelText(BOX))
    expect(butler.callsOf('autostart:set')).toEqual([{ enabled: true }])
    await waitFor(() => expect((screen.getByLabelText(BOX) as HTMLInputElement).checked).toBe(true))
    await user.click(screen.getByLabelText(BOX))
    expect(butler.callsOf('autostart:set')).toEqual([{ enabled: true }, { enabled: false }])
    await waitFor(() => expect((screen.getByLabelText(BOX) as HTMLInputElement).checked).toBe(false))
  })

  it('设置失败：显示原因，勾选状态不变', async () => {
    const user = userEvent.setup()
    installButler({
      'autostart:set': () => {
        throw new Error('系统不让改启动项')
      },
    })
    render(<Harness autostart={{ supported: true, enabled: false }} />)
    await user.click(screen.getByLabelText(BOX))
    expect((await screen.findByRole('alert')).textContent).toContain('系统不让改启动项')
    expect((screen.getByLabelText(BOX) as HTMLInputElement).checked).toBe(false)
  })

  it('不支持（开发模式）：没有开关，说明原因', () => {
    installButler({})
    render(<Harness autostart={{ supported: false, enabled: false }} />)
    expect(screen.queryByLabelText(BOX)).toBeNull()
    expect(screen.getByText(/开发模式，不能设置开机自启/)).toBeTruthy()
  })
})
