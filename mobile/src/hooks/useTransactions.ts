import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchMoreTransactions, fetchTransactions, TransactionFilters, transactionsActions } from '../store/slices/transactionsSlice';

export function useTransactions() {
  const dispatch = useAppDispatch();
  const { transactions, pagination, filters, isLoading, isLoadingMore } = useAppSelector((state) => state.transactions);
  const hasMore = pagination.page < pagination.totalPages;

  const fetchMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return Promise.resolve(null);
    return dispatch(fetchMoreTransactions()).unwrap();
  }, [dispatch, hasMore, isLoadingMore]);

  const refresh = useCallback(() => dispatch(fetchTransactions(filters)).unwrap(), [dispatch, filters]);

  const setFilters = useCallback((nextFilters: TransactionFilters) => {
    dispatch(transactionsActions.setTransactionFilters(nextFilters));
    return dispatch(fetchTransactions({ ...filters, ...nextFilters, page: 1 })).unwrap();
  }, [dispatch, filters]);

  return {
    transactions,
    isLoading: isLoading || isLoadingMore,
    fetchMore,
    hasMore,
    refresh,
    filters,
    setFilters,
  };
}