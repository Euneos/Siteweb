import { test, expect } from 'bun:test'
import { personName, isOwnPerson } from '../src/lib/workspace-people'

test('display first names without exposing email addresses', () => {
  expect(personName('pauline.fixture@example.test')).toBe('Pauline')
  expect(personName('Candice')).toBe('Candice')
  expect(personName('charlotte@example.test')).toBe('Charlotte')
  expect(personName('Partenaires')).toBe('Partenaires')
  expect(personName('gouvernance@example.test')).toBe('Candice')
})
test('name selection cannot grant ownership of another person’s hours', () => {
  expect(isOwnPerson('Pauline', 'pauline.fixture@example.test')).toBe(false)
  expect(isOwnPerson('Pauline', 'pauline.unrelated@example.test')).toBe(false)
  expect(isOwnPerson('Candice', 'pauline.fixture@example.test')).toBe(false)
  expect(isOwnPerson('Partenaires', 'partenaires@example.test')).toBe(false)
  expect(isOwnPerson('Member', 'member@example.test')).toBe(false)
  expect(isOwnPerson('member@example.test', 'member@example.test')).toBe(true)
  expect(isOwnPerson('MEMBER@example.test', 'member@example.test')).toBe(true)
})
