import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'

describe('App', () => {
  it('显示 Butler 标题', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Butler' })).toBeTruthy()
  })
})
