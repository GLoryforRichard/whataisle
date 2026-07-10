/**
 * The routes for the application
 */
export enum Routes {
  Root = '/',

  // marketing pages
  HowItWorks = '/#how-it-works',
  Pricing = '/pricing',
  Docs = '/docs',
  About = '/about',
  Contact = '/contact',
  CookiePolicy = '/cookie',
  PrivacyPolicy = '/privacy',
  TermsOfService = '/terms',

  // auth routes
  Login = '/auth/login',
  Register = '/auth/register',
  AuthError = '/auth/error',
  ForgotPassword = '/auth/forgot-password',
  ResetPassword = '/auth/reset-password',

  // dashboard routes
  Dashboard = '/dashboard',

  // store management (owner)
  ManageVideo = '/manage/video',
  ManageMap = '/manage/map',
  ManageProfile = '/manage/profile',
  ManageShelves = '/manage/shelves',
  ManageInsights = '/manage/insights',
  ManagePosters = '/manage/posters',
  ManageData = '/manage/data',

  // admin routes
  AdminUsers = '/admin/users',
  AdminMapping = '/admin/mapping',
  AdminTenants = '/admin/tenants',
  AdminOnboarding = '/admin/onboarding',
  AdminCosts = '/admin/costs',
  AdminTickets = '/admin/tickets',
  AdminAnnouncements = '/admin/announcements',
  AdminAudit = '/admin/audit',

  // settings routes
  SettingsProfile = '/settings/profile',
  SettingsBilling = '/settings/billing',
  SettingsCredits = '/settings/credits',
  SettingsSecurity = '/settings/security',

  // payment processing
  Payment = '/payment',
}

/**
 * The routes that can not be accessed by logged in users
 */
export const routesNotAllowedByLoggedInUsers = [Routes.Login, Routes.Register];

/**
 * The routes that are protected and require authentication
 */
export const protectedRoutes = [
  Routes.Dashboard,
  Routes.ManageVideo,
  Routes.ManageMap,
  Routes.ManageProfile,
  Routes.ManageShelves,
  Routes.ManageInsights,
  Routes.ManagePosters,
  Routes.ManageData,
  Routes.AdminUsers,
  Routes.AdminMapping,
  Routes.AdminTenants,
  Routes.AdminOnboarding,
  Routes.AdminCosts,
  Routes.AdminTickets,
  Routes.AdminAnnouncements,
  Routes.AdminAudit,
  Routes.SettingsProfile,
  Routes.SettingsBilling,
  Routes.SettingsCredits,
  Routes.SettingsSecurity,
  Routes.Payment,
];

/**
 * The default redirect path after logging in
 */
export const DEFAULT_LOGIN_REDIRECT = Routes.Dashboard;
