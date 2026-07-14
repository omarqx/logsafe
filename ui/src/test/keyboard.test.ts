import { describe, it, expect } from 'vitest'
import { isModifierKeyEvent } from '../lib/keyboard'

function keyEvent(overrides: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) {
  return { metaKey: false, ctrlKey: false, altKey: false, ...overrides }
}

describe('isModifierKeyEvent', () => {
  it('is false when no reserved modifier is held (plain letter shortcuts)', () => {
    expect(isModifierKeyEvent(keyEvent())).toBe(false)
  })

  it('is true when metaKey is held (Cmd+F, Cmd+P, ...)', () => {
    expect(isModifierKeyEvent(keyEvent({ metaKey: true }))).toBe(true)
  })

  it('is true when ctrlKey is held', () => {
    expect(isModifierKeyEvent(keyEvent({ ctrlKey: true }))).toBe(true)
  })

  it('is true when altKey is held', () => {
    expect(isModifierKeyEvent(keyEvent({ altKey: true }))).toBe(true)
  })

  it('does not treat shift alone as a reserved modifier (G is a real app shortcut)', () => {
    const withShiftOnly = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }
    expect(isModifierKeyEvent(withShiftOnly)).toBe(false)
  })
})
