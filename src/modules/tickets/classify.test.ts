import { describe, expect, it } from 'vitest'
import { classifyFaultText } from './classify'

describe('classifyFaultText', () => {
  it('marks HVAC Hebrew as high', () => {
    expect(classifyFaultText('המזגן הראשי לא עובד')).toEqual({
      category: 'hvac',
      priority: 'high',
    })
  })

  it('does not mistake an AC suffix inside a reference identifier for air conditioning', () => {
    expect(classifyFaultText('נזילה בצינור מים visit-trades-1234abac-1234-4321-abcd-123456789012')).toEqual({
      category: 'plumbing',
      priority: 'high',
    })
  })

  it('recognizes AC as a standalone trade term, including at the end of a report', () => {
    expect(classifyFaultText('broken AC')).toEqual({ category: 'hvac', priority: 'high' })
    expect(classifyFaultText('AC-unit is not cooling')).toEqual({ category: 'hvac', priority: 'high' })
  })

  it('marks security as critical', () => {
    expect(classifyFaultText('הדלת לא ננעלת')).toEqual({
      category: 'security',
      priority: 'critical',
    })
  })

  it('defaults unknown to other/medium', () => {
    expect(classifyFaultText('משהו לא בסדר')).toEqual({
      category: 'other',
      priority: 'medium',
    })
  })

  it('reads French and English faults', () => {
    expect(classifyFaultText("de l'eau près de l'électricité").priority).toBe('critical')
    expect(classifyFaultText('la climatisation est en panne')).toEqual({
      category: 'hvac',
      priority: 'high',
    })
    expect(classifyFaultText('there is a leak in the bathroom')).toEqual({
      category: 'plumbing',
      priority: 'high',
    })
  })
})
