import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';
import GoogleProvider from 'next-auth/providers/google';
import { Session } from 'next-auth';

const prisma = new PrismaClient();

interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

const handler = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    session: async ({ session, user }: { session: Session; user: User }) => {
      if (session?.user) {
        session.user = {
          ...session.user,
          id: user.id
        };
      }
      return session;
    },
  },
});

export { handler as GET, handler as POST }; 