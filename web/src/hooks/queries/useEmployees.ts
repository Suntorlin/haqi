import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Employee, EmployeeIssue, EmployeeMemoryResponse, EmployeeMetrics, EmployeeReview } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function errorText(error: unknown, fallback: string): string | null {
    if (!error) return null
    return error instanceof Error ? error.message : fallback
}

/** Every digital employee of the namespace; employee-updated events keep it fresh. */
export function useEmployees(api: ApiClient | null) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: queryKeys.employees,
        queryFn: async () => {
            if (!api) throw new Error('No API client')
            return await api.getEmployees()
        },
        enabled: Boolean(api),
    })

    return {
        employees: (data?.employees ?? []) as Employee[],
        isLoading,
        error: errorText(error, 'Failed to load employees'),
        refetch,
    }
}

/** One employee and its open issues. */
export function useEmployee(api: ApiClient | null, employeeId: string | null) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: queryKeys.employee(employeeId ?? ''),
        queryFn: async () => {
            if (!api || !employeeId) throw new Error('No API client or employee ID')
            return await api.getEmployee(employeeId)
        },
        enabled: Boolean(api && employeeId),
    })

    return {
        employee: (data?.employee ?? null) as Employee | null,
        openIssues: (data?.openIssues ?? []) as EmployeeIssue[],
        isLoading,
        error: errorText(error, 'Failed to load employee'),
        refetch,
    }
}

/** The employee's MEMORY.md snapshot and its own memory rows; employee-updated events keep it fresh. */
export function useEmployeeMemory(api: ApiClient | null, employeeId: string | null, enabled = true) {
    const { data, isLoading, error } = useQuery({
        queryKey: queryKeys.employeeMemory(employeeId ?? ''),
        queryFn: async () => {
            if (!api || !employeeId) throw new Error('No API client or employee ID')
            return await api.getEmployeeMemory(employeeId)
        },
        enabled: Boolean(api && employeeId && enabled),
    })
    return {
        view: (data?.view ?? null) as EmployeeMemoryResponse['view'],
        memories: (data?.memories ?? []) as EmployeeMemoryResponse['memories'],
        isLoading,
        error: errorText(error, 'Failed to load employee memory'),
    }
}

/** The automatic numbers of the last 7 days. */
export function useEmployeeMetrics(api: ApiClient | null, employeeId: string | null, enabled = true) {
    const { data, isLoading, error } = useQuery({
        queryKey: queryKeys.employeeMetrics(employeeId ?? ''),
        queryFn: async () => {
            if (!api || !employeeId) throw new Error('No API client or employee ID')
            return await api.getEmployeeMetrics(employeeId)
        },
        enabled: Boolean(api && employeeId && enabled),
    })
    return {
        metrics: (data?.metrics ?? null) as EmployeeMetrics | null,
        isLoading,
        error: errorText(error, 'Failed to load employee metrics'),
    }
}

/** The weekly reviews, newest first. */
export function useEmployeeReviews(api: ApiClient | null, employeeId: string | null, enabled = true) {
    const { data, isLoading, error } = useQuery({
        queryKey: queryKeys.employeeReviews(employeeId ?? ''),
        queryFn: async () => {
            if (!api || !employeeId) throw new Error('No API client or employee ID')
            return await api.getEmployeeReviews(employeeId)
        },
        enabled: Boolean(api && employeeId && enabled),
    })
    return {
        reviews: (data?.reviews ?? []) as EmployeeReview[],
        isLoading,
        error: errorText(error, 'Failed to load employee reviews'),
    }
}
