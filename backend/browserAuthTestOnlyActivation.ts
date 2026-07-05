export const BROWSER_AUTH_TEST_ONLY_ACTIVATION_NETWORK_EXPOSURE_SAFE = false;
export const BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_AUTHORIZATION = false;
export const BROWSER_AUTH_TEST_ONLY_ACTIVATION_WIRED_INTO_ROUTES = false;
export const BROWSER_AUTH_TEST_ONLY_ACTIVATION_RUNTIME_CONFIGURABLE = false;

export type BrowserAuthTestOnlyActivationAllowance = {
  kind: "browser-auth-test-only-activation";
  allowsDarkHarnessExecution: true;
  runtimeConfigurable: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  networkExposureSafe: false;
};

export function createBrowserAuthTestOnlyActivationAllowance(): BrowserAuthTestOnlyActivationAllowance {
  return {
    kind: "browser-auth-test-only-activation",
    allowsDarkHarnessExecution: true,
    runtimeConfigurable: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    networkExposureSafe: false,
  };
}
