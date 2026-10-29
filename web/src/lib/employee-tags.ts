import type { Employee } from '@/types/api'

/** `employee:<id>` shows as the employee's name (with emoji); any other tag shows as-is. */
export function tagLabel(tag: string, employees: readonly Employee[]): string {
    if (!tag.startsWith('employee:')) return tag
    const id = tag.slice('employee:'.length)
    const match = employees.find((employee) => employee.id === id)
    return match ? `${match.emoji ? `${match.emoji} ` : ''}${match.name}` : tag
}
