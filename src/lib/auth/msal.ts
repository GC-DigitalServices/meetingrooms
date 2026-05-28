import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";
import { getConfig } from "@/lib/config";

// Scopes needed at sign-in:
//   - openid/profile for the id_token (upn, displayName)
//   - User.Read       for GET /me
//   - Group.Read.All for GET /me/transitiveMemberOf
// The delegated token is used exactly twice then discarded.
export const SIGN_IN_SCOPES = ["openid", "profile", "User.Read", "Group.Read.All"];

const globalForMsal = globalThis as unknown as {
  _msalApp?: ConfidentialClientApplication;
  _cryptoProvider?: CryptoProvider;
};

export function getMsalApp(): ConfidentialClientApplication {
  if (globalForMsal._msalApp) return globalForMsal._msalApp;

  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = getConfig();

  const app = new ConfidentialClientApplication({
    auth: {
      clientId: AZURE_CLIENT_ID,
      clientSecret: AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    },
  });

  if (process.env.NODE_ENV !== "production") globalForMsal._msalApp = app;
  return app;
}

export function getCryptoProvider(): CryptoProvider {
  if (globalForMsal._cryptoProvider) return globalForMsal._cryptoProvider;
  const p = new CryptoProvider();
  if (process.env.NODE_ENV !== "production") globalForMsal._cryptoProvider = p;
  return p;
}
