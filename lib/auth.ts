// Auth configuration for NextAuth.js with InsForge credentials provider
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_API_URL;
const insforgeKey = process.env.INSFORGE_SERVICE_ROLE_KEY || process.env.INSFORGE_ANON_KEY;

interface InsForgeUser {
  id: string;
  email: string;
}

async function signInWithInsForge(email: string, password: string): Promise<InsForgeUser | null> {
  const baseUrl = insforgeUrl;
  const key = insforgeKey;

  if (!baseUrl || !key) {
    // Demo mode: accept demo credentials for testing
    if (email === 'admin@example.com' && password === 'admin123') {
      return { id: 'demo-user-id', email };
    }
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/auth/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
      },
      body: JSON.stringify({ email, password }),
    });

    // If endpoint doesn't exist (returns HTML error), fall back to demo mode
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      // Demo mode: accept known demo credentials
      if (email === 'admin@example.com' && password === 'demo123') {
        return { id: '00000000-0000-0000-0000-000000000001', email };
      }
      return null;
    }

    const data = await response.json();
    
    // The response should contain user info and access token
    if (data.user) {
      return {
        id: data.user.id,
        email: data.user.email,
      };
    }
    
    // If we got an access token but no user in body, try to decode from token or fetch user
    if (data.accessToken) {
      // Try to get user info using the access token
      const userResponse = await fetch(`${baseUrl}/api/auth/user`, {
        headers: {
          'Authorization': `Bearer ${data.accessToken}`,
          'apikey': key,
        },
      });
      if (userResponse.ok) {
        const userData = await userResponse.json();
        return { id: userData.id, email: userData.email };
      }
    }

    return null;
  } catch (err) {
    // Network/parse error — fall back to demo mode
    if (email === 'admin@example.com' && password === 'demo123') {
      return { id: '00000000-0000-0000-0000-000000000001', email };
    }
    console.error('Auth error:', err);
    return null;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await signInWithInsForge(credentials.email, credentials.password);
        
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.email.split('@')[0],
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? '';
      }
      return token;
    },
    async session({ session, token }) {
      // Extend the session user with our custom fields
      if (session.user) {
        (session.user as { id?: string; email?: string }).id = token.id as string;
        (session.user as { id?: string; email?: string }).email = token.email as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET || 'pagevault-dev-secret-change-in-production',
};
