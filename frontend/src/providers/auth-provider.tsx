import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import posthog from "posthog-js";
import { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN } from "@/config/env";
import {
  getUserProfile,
  ensureUserProfile,
  type UserProfile,
} from "@/lib/supabase/profiles";
import { useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const userRef = useRef<User | null>(null);
  const initializedRef = useRef(false);
  const profileRequestRef = useRef(0);

  const fetchProfile = useCallback(
    async (userId: string, email?: string) => {
      const requestId = profileRequestRef.current + 1;
      profileRequestRef.current = requestId;
      setProfileLoading(true);

      try {
        const isNewUser = await ensureUserProfile(userId, email).catch((error: unknown) => {
          console.error("Error ensuring profile:", error);
          return false;
        });

        const userProfile = await getUserProfile(userId).catch((error: unknown) => {
          console.error("Error fetching profile:", error);
          return null;
        });

        if (profileRequestRef.current !== requestId) return;
        setProfile(userProfile);

        if (isNewUser) {
          router.push("/onboarding");
        }
      } catch (error) {
        console.error("Error in profile fetch:", error);
      } finally {
        if (profileRequestRef.current === requestId) {
          setProfileLoading(false);
        }
      }
    },
    [router]
  );

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setProfileLoading(true);
    const userProfile = await getUserProfile(user.id).catch((error: unknown) => {
      console.error("Error refreshing profile:", error);
      return null;
    });
    if (profileRequestRef.current !== requestId) return;
    setProfile(userProfile);
    setProfileLoading(false);
  }, [user]);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    profileRequestRef.current += 1;
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    router.push("/");
  }, [supabase, router]);

  useEffect(() => {
    let active = true;

    // Prevent multiple initializations
    if (initializedRef.current) {
      return () => {
        active = false;
      };
    }

    const initAuth = async () => {
      try {
        // First, try to get the session from cookies to restore it
        const {
          data: { session },
        } = await supabase.auth.getSession();

        // If we have a session, use it to restore the user
        // Otherwise, try getUser() which will attempt to refresh
        let currentUser: User | null = null;

        if (session?.user) {
          currentUser = session.user;
        } else {
          // If no session, try getUser() which may refresh from cookies
          const {
            data: { user },
            error,
          } = await supabase.auth.getUser();

          if (!error && user) {
            currentUser = user;
          }
        }

        userRef.current = currentUser;
        if (!active) return;
        setUser(currentUser);
        if (!currentUser) {
          setProfile(null);
          setProfileLoading(false);
        }
        setLoading(false);
        initializedRef.current = true;

        if (currentUser) {
          void fetchProfile(currentUser.id, currentUser.email || undefined);
        }
      } catch (error) {
        console.error("Unexpected error in auth init:", error);
        // Ensure loading state is resolved even on error
        userRef.current = null;
        if (!active) return;
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
        setLoading(false);
        initializedRef.current = true;
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!active) return;

      const currentUser = session?.user ?? null;

      // Handle INITIAL_SESSION event - this fires on first load with existing session
      if (event === "INITIAL_SESSION") {
        if (currentUser && currentUser.id !== userRef.current?.id) {
          userRef.current = currentUser;
          setUser(currentUser);
          setLoading(false);
          void fetchProfile(currentUser.id, currentUser.email || undefined);
        } else if (!currentUser && userRef.current) {
          // Session was cleared
          userRef.current = null;
          setUser(null);
          setProfile(null);
          setProfileLoading(false);
          setLoading(false);
        }
        return;
      }

      // Only update if user changed to avoid unnecessary profile fetches
      if (currentUser?.id !== userRef.current?.id) {
        userRef.current = currentUser;
        setUser(currentUser);
        if (currentUser) {
          setLoading(false);
          void fetchProfile(currentUser.id, currentUser.email || undefined);
        } else {
          setProfile(null);
          setProfileLoading(false);
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  useEffect(() => {
    if (!NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
      return;
    }

    if (user) {
      posthog.identify(user.id, {
        email: user.email,
        auth_provider: profile?.auth_provider ?? undefined,
        display_name: profile?.first_name ?? undefined,
      });
      return;
    }

    posthog.reset();
  }, [user, profile]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
