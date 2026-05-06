import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { LoginCredentials, loginUser, logoutUser } from '../store/slices/authSlice';

export function useAuth() {
  const dispatch = useAppDispatch();
  const { user, isAuthenticated, isLoading } = useAppSelector((state) => state.auth);

  const login = useCallback((credentials: LoginCredentials) => dispatch(loginUser(credentials)).unwrap(), [dispatch]);
  const logout = useCallback(() => dispatch(logoutUser()).unwrap(), [dispatch]);

  return {
    user,
    isAuthenticated,
    isAdmin: user?.role === 'admin',
    login,
    logout,
    isLoading,
  };
}