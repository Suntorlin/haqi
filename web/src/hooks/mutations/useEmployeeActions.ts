import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { EmployeeInput, EmployeePatch } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function requireApi(api: ApiClient | null): ApiClient {
    if (!api) throw new Error('No API client')
    return api
}

/** Create, edit, delete, wake and the memory actions of a digital employee. Each refreshes the list and the detail. */
export function useEmployeeActions(api: ApiClient | null) {
    const queryClient = useQueryClient()
    const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.employees })

    const create = useMutation({
        mutationFn: async (input: EmployeeInput) => (await requireApi(api).createEmployee(input)).employee,
        onSuccess: invalidate,
    })

    const update = useMutation({
        mutationFn: async (args: { id: string; patch: EmployeePatch }) => (await requireApi(api).updateEmployee(args.id, args.patch)).employee,
        onSuccess: invalidate,
    })

    const remove = useMutation({
        mutationFn: async (id: string) => {
            await requireApi(api).deleteEmployee(id)
        },
        onSuccess: (_data, id) => {
            queryClient.removeQueries({ queryKey: queryKeys.employee(id) })
            return invalidate()
        },
    })

    const wake = useMutation({
        mutationFn: async (args: { id: string; text?: string }) => await requireApi(api).wakeEmployee(args.id, args.text),
        onSettled: invalidate,
    })

    const generateMemory = useMutation({
        mutationFn: async (id: string) => await requireApi(api).generateEmployeeMemory(id),
        onSettled: invalidate,
    })

    const syncMemory = useMutation({
        mutationFn: async (id: string) => await requireApi(api).syncEmployeeMemory(id),
        onSettled: invalidate,
    })

    const maintain = useMutation({
        mutationFn: async (id: string) => await requireApi(api).maintainEmployee(id),
        onSettled: invalidate,
    })

    return { create, update, remove, wake, generateMemory, syncMemory, maintain }
}
