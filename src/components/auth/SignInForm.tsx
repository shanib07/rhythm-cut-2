'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function SignInForm() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      await signIn('google', {
        callbackUrl: '/',
      });
    } catch (error) {
      console.error('Sign in error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-8 space-y-6">
      <button
        onClick={handleGoogleSignIn}
        disabled={isLoading}
        className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
          isLoading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
        } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
      >
        {isLoading ? (
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
            Signing in...
          </div>
        ) : (
          'Sign in with Google'
        )}
      </button>
    </div>
  );
} 