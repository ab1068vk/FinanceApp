import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CardStyleInterpolators, createStackNavigator } from '@react-navigation/stack';
import { createNavigationContainerRef, useNavigation, type NavigatorScreenParams } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Modal from 'react-native-modal';
import Feather from '@expo/vector-icons/Feather';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { useAppSelector } from '../store/hooks';
import { useTheme } from '../theme';
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import VerifyEmailScreen from '../screens/auth/VerifyEmailScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import OverviewScreen from '../screens/dashboard/OverviewScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import AccountsScreen from '../screens/accounts/AccountsScreen';
import AddAccountScreen from '../screens/accounts/AddAccountScreen';
import AccountDetailScreen from '../screens/accounts/AccountDetailScreen';
import EditAccountScreen from '../screens/accounts/EditAccountScreen';
import TransactionsScreen from '../screens/transactions/TransactionsScreen';
import TransactionDetailScreen from '../screens/transactions/TransactionDetailScreen';
import AddTransactionScreen from '../screens/transactions/AddTransactionScreen';
import EditTransactionScreen from '../screens/transactions/EditTransactionScreen';
import BudgetsScreen from '../screens/budget/BudgetsScreen';
import BudgetDetailScreen from '../screens/budget/BudgetDetailScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import CategoriesScreen from '../screens/categories/CategoriesScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import ChangePasswordScreen from '../screens/profile/ChangePasswordScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import ActiveSessionsScreen from '../screens/profile/ActiveSessionsScreen';
import OfflineQueueScreen from '../screens/profile/OfflineQueueScreen';
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import UsersListScreen from '../screens/admin/UsersListScreen';
import UserDetailScreen from '../screens/admin/UserDetailScreen';
import DeletedUsersScreen from '../screens/admin/DeletedUsersScreen';
import AuditLogsScreen from '../screens/admin/AuditLogsScreen';
import SystemHealthScreen from '../screens/admin/SystemHealthScreen';
import AdminTransactionsScreen from '../screens/admin/AdminTransactionsScreen';
import DefaultCategoriesScreen from '../screens/admin/DefaultCategoriesScreen';
import AdminToolsScreen from '../screens/admin/AdminToolsScreen';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: { resetToken?: string; email?: string } | undefined;
  VerifyEmail: { verificationToken?: string; email?: string } | undefined;
};

export type DashboardStackParamList = {
  DashboardHome: undefined;
  Overview: undefined;
  Notifications: undefined;
};

export type AccountsStackParamList = {
  AccountsHome: undefined;
  AddAccount: undefined;
  AccountDetail: { id: string };
  EditAccount: { id: string };
};

export type TransactionsStackParamList = {
  TransactionsHome: undefined;
  TransactionDetail: { id: string };
  EditTransaction: { id: string };
  AddTransaction: { defaultType?: 'expense' | 'income' | 'transfer' } | undefined;
};

export type BudgetsStackParamList = {
  BudgetsHome: undefined;
  BudgetDetail: { id: string };
};

export type ReportsStackParamList = {
  ReportsHome: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: { verifyNewEmailToken?: string } | undefined;
  Settings: undefined;
  Categories: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  ActiveSessions: undefined;
  OfflineQueue: undefined;
};

export type AdminStackParamList = {
  AdminDashboard: undefined;
  UsersList: { initialFilter?: 'all' | 'active' | 'inactive' | 'admin' | 'locked' } | undefined;
  UserDetail: { id: string };
  DeletedUsers: undefined;
  AuditLogs: { initialAction?: string } | undefined;
  SystemHealth: undefined;
  AdminTransactions: undefined;
  DefaultCategories: undefined;
  AdminTools: undefined;
};

export type AppTabParamList = {
  Dashboard: NavigatorScreenParams<DashboardStackParamList> | undefined;
  Accounts: NavigatorScreenParams<AccountsStackParamList> | undefined;
  Transactions: NavigatorScreenParams<TransactionsStackParamList> | undefined;
  Budgets: NavigatorScreenParams<BudgetsStackParamList> | undefined;
  Reports: NavigatorScreenParams<ReportsStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
  Admin: NavigatorScreenParams<AdminStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  App: NavigatorScreenParams<AppTabParamList> | undefined;
  ForceChangePassword: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const AuthStackNavigator = createStackNavigator<AuthStackParamList>();
const RootStackNavigator = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<AppTabParamList>();
const DashboardStack = createStackNavigator<DashboardStackParamList>();
const AccountsStack = createStackNavigator<AccountsStackParamList>();
const TransactionsStack = createStackNavigator<TransactionsStackParamList>();
const BudgetsStack = createStackNavigator<BudgetsStackParamList>();
const ReportsStack = createStackNavigator<ReportsStackParamList>();
const ProfileStack = createStackNavigator<ProfileStackParamList>();
const AdminStackNavigator = createStackNavigator<AdminStackParamList>();
const AppMenuContext = React.createContext({ openMenu: () => {} });

type MenuItem = {
  name: keyof AppTabParamList;
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
};

const menuItems: MenuItem[] = [
  { name: 'Dashboard', label: 'Dashboard', icon: 'grid' },
  { name: 'Accounts', label: 'Accounts', icon: 'credit-card' },
  { name: 'Transactions', label: 'Transactions', icon: 'list' },
  { name: 'Budgets', label: 'Budgets', icon: 'pie-chart' },
  { name: 'Reports', label: 'Reports', icon: 'bar-chart-2' },
  { name: 'Profile', label: 'Profile', icon: 'user' },
];

function MenuButton() {
  const { openMenu } = React.useContext(AppMenuContext);
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.headerMenuButton} onPress={openMenu} accessibilityRole="button" accessibilityLabel="Open navigation menu">
      <Feather name="menu" size={22} color={theme.colors.text.primary} />
    </TouchableOpacity>
  );
}

function AdminShortcutButton() {
  const navigation = useNavigation<any>();
  const user = useAppSelector((state) => state.auth.user);
  const theme = useTheme();

  if (user?.role !== 'admin') return null;

  return (
    <TouchableOpacity
      style={styles.headerAdminButton}
      onPress={() => navigation.navigate('Admin', { screen: 'AdminDashboard' })}
      accessibilityRole="button"
      accessibilityLabel="Open admin dashboard"
    >
      <Feather name="shield" size={20} color={theme.colors.highlight} />
    </TouchableOpacity>
  );
}

function rootHeaderOptions(title: string) {
  return { title, headerLeft: () => <MenuButton />, headerRight: () => <AdminShortcutButton /> };
}

function screenOptions(theme: ReturnType<typeof useTheme>) {
  return {
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTintColor: theme.colors.text.primary,
    headerTitleStyle: { fontWeight: '700' as const },
    cardStyle: { backgroundColor: theme.colors.background },
  };
}

function AuthStack() {
  const theme = useTheme();

  return (
    <AuthStackNavigator.Navigator screenOptions={{ ...screenOptions(theme), headerShown: false }}>
      <AuthStackNavigator.Screen name="Login" component={LoginScreen} />
      <AuthStackNavigator.Screen name="Register" component={RegisterScreen} />
      <AuthStackNavigator.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Forgot Password' }} />
      <AuthStackNavigator.Screen name="VerifyEmail" component={VerifyEmailScreen} options={{ title: 'Verify Email' }} />
    </AuthStackNavigator.Navigator>
  );
}

function DashboardStackScreen() {
  const theme = useTheme();

  return (
    <DashboardStack.Navigator screenOptions={screenOptions(theme)}>
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={rootHeaderOptions('Dashboard')} />
      <DashboardStack.Screen name="Overview" component={OverviewScreen} options={{ title: 'Overview' }} />
      <DashboardStack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
    </DashboardStack.Navigator>
  );
}

function AccountsStackScreen() {
  const theme = useTheme();

  return (
    <AccountsStack.Navigator screenOptions={screenOptions(theme)}>
      <AccountsStack.Screen name="AccountsHome" component={AccountsScreen} options={rootHeaderOptions('Accounts')} />
      <AccountsStack.Screen name="AddAccount" component={AddAccountScreen} options={{ title: 'Add Account', presentation: 'modal' }} />
      <AccountsStack.Screen name="AccountDetail" component={AccountDetailScreen} options={{ title: 'Account Detail' }} />
      <AccountsStack.Screen name="EditAccount" component={EditAccountScreen} options={{ title: 'Edit Account', presentation: 'modal' }} />
    </AccountsStack.Navigator>
  );
}

function TransactionsStackScreen() {
  const theme = useTheme();

  return (
    <TransactionsStack.Navigator screenOptions={screenOptions(theme)}>
      <TransactionsStack.Screen name="TransactionsHome" component={TransactionsScreen} options={rootHeaderOptions('Transactions')} />
      <TransactionsStack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ title: 'Transaction Detail' }} />
      <TransactionsStack.Screen name="EditTransaction" component={EditTransactionScreen} options={{ title: 'Edit Transaction', presentation: 'modal' }} />
      <TransactionsStack.Screen name="AddTransaction" component={AddTransactionScreen} options={{ headerShown: false, presentation: 'modal' }} />
    </TransactionsStack.Navigator>
  );
}

function BudgetsStackScreen() {
  const theme = useTheme();

  return (
    <BudgetsStack.Navigator screenOptions={screenOptions(theme)}>
      <BudgetsStack.Screen name="BudgetsHome" component={BudgetsScreen} options={rootHeaderOptions('Budgets')} />
      <BudgetsStack.Screen name="BudgetDetail" component={BudgetDetailScreen} options={{ title: 'Budget Detail' }} />
    </BudgetsStack.Navigator>
  );
}

function ReportsStackScreen() {
  const theme = useTheme();

  return (
    <ReportsStack.Navigator screenOptions={screenOptions(theme)}>
      <ReportsStack.Screen name="ReportsHome" component={ReportsScreen} options={rootHeaderOptions('Reports')} />
    </ReportsStack.Navigator>
  );
}

function ProfileStackScreen() {
  const theme = useTheme();

  return (
    <ProfileStack.Navigator screenOptions={screenOptions(theme)}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} options={rootHeaderOptions('Profile')} />
      <ProfileStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <ProfileStack.Screen name="Categories" component={CategoriesScreen} options={{ title: 'Categories' }} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile', presentation: 'modal' }} />
      <ProfileStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change Password' }} />
      <ProfileStack.Screen name="ActiveSessions" component={ActiveSessionsScreen} options={{ title: 'Active Sessions' }} />
      <ProfileStack.Screen name="OfflineQueue" component={OfflineQueueScreen} options={{ title: 'Offline Queue' }} />
    </ProfileStack.Navigator>
  );
}

function AdminStack() {
  const theme = useTheme();

  return (
    <ErrorBoundary screen="Admin">
      <AdminStackNavigator.Navigator screenOptions={screenOptions(theme)}>
        <AdminStackNavigator.Screen name="AdminDashboard" component={AdminDashboardScreen} options={rootHeaderOptions('Admin')} />
        <AdminStackNavigator.Screen name="UsersList" component={UsersListScreen} options={{ title: 'Users' }} />
        <AdminStackNavigator.Screen name="UserDetail" component={UserDetailScreen} options={{ title: 'User Detail' }} />
        <AdminStackNavigator.Screen name="DeletedUsers" component={DeletedUsersScreen} options={{ title: 'Deleted Users' }} />
        <AdminStackNavigator.Screen name="AuditLogs" component={AuditLogsScreen} options={{ title: 'Audit Logs' }} />
        <AdminStackNavigator.Screen name="SystemHealth" component={SystemHealthScreen} options={{ title: 'System Health' }} />
        <AdminStackNavigator.Screen name="AdminTransactions" component={AdminTransactionsScreen} options={{ title: 'Global Transactions' }} />
        <AdminStackNavigator.Screen name="DefaultCategories" component={DefaultCategoriesScreen} options={{ title: 'Default Categories' }} />
        <AdminStackNavigator.Screen name="AdminTools" component={AdminToolsScreen} options={{ title: 'Admin Tools' }} />
      </AdminStackNavigator.Navigator>
    </ErrorBoundary>
  );
}

function AppStack() {
  const theme = useTheme();
  const user = useAppSelector((state) => state.auth.user);
  const [menuVisible, setMenuVisible] = React.useState(false);
  const isAdmin = user?.role === 'admin';
  const availableMenuItems = React.useMemo(
    () => (isAdmin
      ? [{ name: 'Admin' as const, label: 'Admin Dashboard', icon: 'shield' as const }, ...menuItems]
      : menuItems),
    [isAdmin]
  );

  return (
    <AppMenuContext.Provider value={{ openMenu: () => setMenuVisible(true) }}>
      <Tab.Navigator
        initialRouteName={isAdmin ? 'Admin' : 'Dashboard'}
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <AppMenu
            visible={menuVisible}
            activeRouteName={props.state.routes[props.state.index]?.name as keyof AppTabParamList}
            menuItems={availableMenuItems}
            onClose={() => setMenuVisible(false)}
            onNavigate={(name) => {
              props.navigation.navigate(name);
              setMenuVisible(false);
            }}
          />
        )}
      >
        {isAdmin ? <Tab.Screen name="Admin" component={AdminStack} /> : null}
        <Tab.Screen name="Dashboard" component={DashboardStackScreen} />
        <Tab.Screen name="Accounts" component={AccountsStackScreen} />
        <Tab.Screen name="Transactions" component={TransactionsStackScreen} />
        <Tab.Screen name="Budgets" component={BudgetsStackScreen} />
        <Tab.Screen name="Reports" component={ReportsStackScreen} />
        <Tab.Screen name="Profile" component={ProfileStackScreen} />
      </Tab.Navigator>
    </AppMenuContext.Provider>
  );
}

function AppMenu({ visible, activeRouteName, menuItems: visibleMenuItems, onClose, onNavigate }: {
  visible: boolean;
  activeRouteName?: keyof AppTabParamList;
  menuItems: MenuItem[];
  onClose: () => void;
  onNavigate: (name: keyof AppTabParamList) => void;
}) {
  return (
    <Modal
      isVisible={visible}
      animationIn="slideInLeft"
      animationOut="slideOutLeft"
      backdropOpacity={0.36}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.menuModal}
    >
      <View style={styles.menuPanel}>
        <View style={styles.menuHeader}>
          <View style={styles.menuLogo}><Feather name="dollar-sign" size={22} color="#FFFFFF" /></View>
          <View style={styles.menuTitleBlock}>
            <Text style={styles.menuTitle}>FinanceApp</Text>
            <Text style={styles.menuSubtitle}>Navigation</Text>
          </View>
          <TouchableOpacity style={styles.menuCloseButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close navigation menu">
            <Feather name="x" size={22} color="#1A1A2E" />
          </TouchableOpacity>
        </View>
        <View style={styles.menuList}>
          {visibleMenuItems.map((item) => {
            const active = activeRouteName === item.name;
            return (
              <TouchableOpacity key={item.name} style={[styles.menuItem, active && styles.menuItemActive]} onPress={() => onNavigate(item.name)} activeOpacity={0.78}>
                <Feather name={item.icon} size={20} color={active ? '#FFFFFF' : '#0F3460'} />
                <Text style={[styles.menuItemText, active && styles.menuItemTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

export function RootNavigator() {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const user = useAppSelector((state) => state.auth.user);

  return (
    <RootStackNavigator.Navigator
      screenOptions={{
        headerShown: false,
        cardStyleInterpolator: CardStyleInterpolators.forFadeFromCenter,
      }}
    >
      {isAuthenticated && user?.must_change_password ? (
        <RootStackNavigator.Screen name="ForceChangePassword" component={ChangePasswordScreen} options={{ gestureEnabled: false }} />
      ) : isAuthenticated ? (
        <RootStackNavigator.Screen name="App" component={AppStack} />
      ) : (
        <RootStackNavigator.Screen name="Auth" component={AuthStack} />
      )}
    </RootStackNavigator.Navigator>
  );
}

const styles = StyleSheet.create({
  headerMenuButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  headerAdminButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  menuModal: { margin: 0, justifyContent: 'flex-start', alignItems: 'flex-start' },
  menuPanel: { width: 304, maxWidth: '86%', height: '100%', backgroundColor: '#FFFFFF', paddingTop: 48, paddingHorizontal: 18 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  menuLogo: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E94560', alignItems: 'center', justifyContent: 'center' },
  menuTitleBlock: { flex: 1, marginLeft: 12 },
  menuTitle: { color: '#1A1A2E', fontSize: 20, fontWeight: '900' },
  menuSubtitle: { color: '#6C757D', fontSize: 12, fontWeight: '800', marginTop: 2 },
  menuCloseButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  menuList: { gap: 8 },
  menuItem: { height: 50, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuItemActive: { backgroundColor: '#0F3460' },
  menuItemText: { color: '#1A1A2E', fontSize: 15, fontWeight: '900' },
  menuItemTextActive: { color: '#FFFFFF' },
});



