export type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export type PaginationMeta = {
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  total?: number;
  limit?: number;
  totalPages?: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: PaginationMeta;
};

export type ListPayload<T> = T[] | PaginatedResponse<T>;

export function unwrapList<T>(payload: ListPayload<T>): T[] {
  return Array.isArray(payload) ? payload : payload.data;
}
