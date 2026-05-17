import type { AuthConfig } from '@vercel-internals/types';

export type AuthAccount = {
  token: string;
  email: string;
  userId?: string;
  refreshToken?: string;
  expiresAt?: number;
};

export type MultiAccountAuthConfig = AuthConfig & {
  activeAccount?: string;
  accounts?: Record<string, AuthAccount>;
};

export function getMultiAccountAuthConfig(
  authConfig: AuthConfig
): MultiAccountAuthConfig {
  return authConfig as MultiAccountAuthConfig;
}

export function applyActiveAccount(
  authConfig: MultiAccountAuthConfig
): AuthConfig {
  const multiAuthConfig = getMultiAccountAuthConfig(authConfig);
  if (multiAuthConfig.tokenSource) {
    return authConfig;
  }

  const activeAccount = getActiveAccount(multiAuthConfig);
  if (!activeAccount) {
    return authConfig;
  }

  const nextAuthConfig: MultiAccountAuthConfig = {
    ...multiAuthConfig,
    token: activeAccount.token,
    userId: activeAccount.userId,
    expiresAt: activeAccount.expiresAt,
  };

  if (activeAccount.refreshToken) {
    nextAuthConfig.refreshToken = activeAccount.refreshToken;
  } else {
    delete nextAuthConfig.refreshToken;
  }

  if (!activeAccount.userId) {
    delete nextAuthConfig.userId;
  }

  if (!activeAccount.expiresAt) {
    delete nextAuthConfig.expiresAt;
  }

  return nextAuthConfig;
}

export function addAuthAccount(
  authConfig: AuthConfig,
  label: string,
  account: AuthAccount
): AuthConfig {
  const multiAuthConfig = getMultiAccountAuthConfig(authConfig);
  return applyActiveAccount({
    ...multiAuthConfig,
    activeAccount: label,
    accounts: {
      ...multiAuthConfig.accounts,
      [label]: account,
    },
  });
}

export function removeActiveAuthAccount(authConfig: AuthConfig): AuthConfig {
  const multiAuthConfig = getMultiAccountAuthConfig(authConfig);
  const { activeAccount, accounts } = multiAuthConfig;
  if (!activeAccount || !accounts?.[activeAccount]) {
    return authConfig.skipWrite ? { skipWrite: true } : {};
  }

  const nextAccounts = { ...accounts };
  delete nextAccounts[activeAccount];
  const nextActiveAccount = Object.keys(nextAccounts).sort((a, b) =>
    a.localeCompare(b)
  )[0];

  if (!nextActiveAccount) {
    return authConfig.skipWrite ? { skipWrite: true } : {};
  }

  return applyActiveAccount({
    ...multiAuthConfig,
    accounts: nextAccounts,
    activeAccount: nextActiveAccount,
  });
}

export function syncActiveAuthAccount(authConfig: AuthConfig): AuthConfig {
  const multiAuthConfig = getMultiAccountAuthConfig(authConfig);
  const { activeAccount, accounts, token } = multiAuthConfig;
  if (!activeAccount || !accounts?.[activeAccount] || !token) {
    return authConfig;
  }

  return addAuthAccount(authConfig, activeAccount, {
    ...accounts[activeAccount],
    token,
    userId: multiAuthConfig.userId,
    refreshToken: multiAuthConfig.refreshToken,
    expiresAt: multiAuthConfig.expiresAt,
  });
}

export function getAuthAccountLabels(authConfig: AuthConfig): string[] {
  const accounts = getMultiAccountAuthConfig(authConfig).accounts;
  if (!accounts) {
    return [];
  }
  return Object.keys(accounts).sort((a, b) => a.localeCompare(b));
}

export function getActiveAccountLabel(authConfig: AuthConfig): string | null {
  const { activeAccount, accounts } = getMultiAccountAuthConfig(authConfig);
  if (activeAccount && accounts?.[activeAccount]) {
    return activeAccount;
  }
  return null;
}

function getActiveAccount(
  authConfig: MultiAccountAuthConfig
): AuthAccount | null {
  if (!authConfig.activeAccount || !authConfig.accounts) {
    return null;
  }
  return authConfig.accounts[authConfig.activeAccount] ?? null;
}
